// Layer-1 pieces of The Diff (prototype/pages/approval/variant-3): the window's title bar, the
// twin header, the two-sided comparison with a ✓ / ✕ / ! / ? mark per row, the market line, the
// status pill and the footer's due line. Presentational only: DealReview owns data, gates and
// commands. Words follow docs/ux/UX-GUIDE.md: plain on Layer 1, provenance one click down.
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import type { Deal } from '@bindings/Deal';
import type { MarketRef } from '@bindings/MarketRef';
import type { Mode } from '@bindings/Mode';
import { clockLabel, formatMoney } from '../../../lib/format';
import { marketWords } from '../../../lib/words';
import { Countdown, MockBadge, ModeBadge } from '../../../shared/honesty';
import { Btn, Crumbs, Hourglass, Spacer, TitleBar, type ChipTone } from '../../../shared/ui';
import { marketPercentile, STEP } from '../model';
import type { Step } from '../model';
import { Emblem } from '../ui';
import { relMark, rowWord, type DiffRow, type Mark, type RowTone, type Twin } from './diff';

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

// ---- chrome ---------------------------------------------------------------------------------

/** The approval window's own title bar. Sheets drop from its bottom edge (--sheet-top). */
export function ReviewBar({ module, label, mode, onDetails }: { module: string | null; label: string | null; mode: Mode | undefined; onDetails?: (e: MouseEvent<HTMLButtonElement>) => void }) {
  return (
    <TitleBar className="dr-bar">
      <Emblem />
      <span className="ui-title" id="awTitle">Approval</span>
      <Crumbs label="Where this comes from" items={[{ label: 'The Table' }, ...(module ? [{ label: module }] : []), ...(label ? [{ label }] : [])]} />
      <Spacer />
      {mode ? <ModeBadge mode={mode} /> : null}
      <MockBadge />
      {onDetails ? (
        <Btn kind="plain" sm onClick={onDetails} title="Where every check came from, the full history and the proof">
          Details
        </Btn>
      ) : null}
    </TitleBar>
  );
}

// ---- marks ----------------------------------------------------------------------------------

/** The round mark for a reading: ✓ passes, ✕ fails, ! paused, ? not checked here, … waiting. */
export function MarkIcon({ mark, className }: { mark: Mark; className?: string }) {
  return <span className={cx('dr-mark', `m-${MARK_CLASS[mark]}`, className)} aria-hidden="true">{mark}</span>;
}
const MARK_CLASS: Record<Mark, string> = { '✓': 'ok', '✕': 'bad', '!': 'hold', '?': 'unk', '…': 'wait', i: 'info' };

// ---- twin header ----------------------------------------------------------------------------

const TWIN_WORD: Partial<Record<Twin['op'], string>> = { '≥': 'fits', '=': 'matches', '≤': 'fits', '≠': 'differs', '<': 'over', '?': 'can’t compare' };

export function TwinHeader({ twin, checking }: { twin: Twin; checking: boolean }) {
  // A paused request compares the amount with your limit; the pause itself is the scam check's
  // (its own row and the status pill), so the mark here reads the amount only.
  const held = twin.tone === 'hold';
  const tone: RowTone = checking ? 'wait' : twin.op === '≠' ? 'bad' : held ? (twin.op === '≥' ? 'ok' : twin.op === '<' ? 'bad' : 'info') : twin.tone;
  const mark: Mark = checking ? '…' : twin.op === '?' ? '?' : tone === 'ok' ? '✓' : tone === 'bad' ? '✕' : tone === 'hold' ? '!' : 'i';
  const word = checking ? 'checking' : held && twin.op !== '?' ? (twin.op === '≥' ? 'within limit' : 'over limit') : TWIN_WORD[twin.op] ?? '';
  return (
    <div className={cx('dr-twin', tone === 'bad' && 't-bad', held && 't-hold')}>
      <div className="tw l">
        <span className="twk">{twin.left.k}</span>
        {twin.left.v ? <span className="tw-amt money">{twin.left.v}</span> : <span className="tw-amt unk">not shown here</span>}
      </div>
      <div className={`tw-op ${tone}`} role="img" aria-label={checking ? 'checking' : word}>
        <MarkIcon mark={mark} className="big" />
        <span className="w">{word}</span>
      </div>
      <div className="tw r">
        <span className="twk">{twin.right.k}</span>
        {twin.right.v ? <span className="tw-amt money">{twin.right.v}</span> : <span className="tw-amt unk">{twin.op === '≠' ? 'differs' : 'not shown here'}</span>}
      </div>
    </div>
  );
}

// ---- the comparison -------------------------------------------------------------------------

export type RowSet = 'pre' | 'ev';

/** Every focusable row of the window: the evidence table's rows and the checks' source buttons. */
export const ROW_SELECTOR = '.dr-row, .dr-src';

/** Arrow keys move between rows of every table in the window; Space / Enter open the sources. */
export function onRowKey(e: KeyboardEvent<HTMLButtonElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const all = Array.from(document.querySelectorAll<HTMLButtonElement>(ROW_SELECTOR));
  const i = all.indexOf(e.currentTarget);
  const n = all[i + (e.key === 'ArrowDown' ? 1 : -1)];
  if (n) {
    e.preventDefault();
    n.focus();
  }
}

export function DiffTable({ heads, rows, set, revealed, onOpen, open }: {
  heads: [string, string];
  rows: DiffRow[];
  set: RowSet;
  /** Rows at or past this index are still being read (CHECKING); undefined = all revealed. */
  revealed?: number;
  onOpen: (row: DiffRow, set: RowSet, el: HTMLElement) => void;
  open: string | null;
}) {
  return (
    <div className="ui-group dt" role="group" aria-label={`${heads[0]} compared with ${heads[1]}`}>
      <div className="dt-h" aria-hidden="true">
        <span className="n" />
        <span className="l">{heads[0]}</span>
        <span />
        <span className="r">{heads[1]}</span>
      </div>
      {rows.map((x, i) => {
        const wait = revealed !== undefined && i >= revealed;
        const tone: RowTone = wait ? 'wait' : x.tone;
        const mark: Mark = wait ? '…' : relMark(x.rel, x.tone);
        const word = wait ? 'checking' : rowWord(x);
        const right = x.right ?? 'not shown here';
        return (
          <button
            key={x.id}
            type="button"
            className={cx('dr-row', tone, x.rel === '?' && 'unk', open === `${set}:${x.id}` && 'on')}
            onClick={(e) => onOpen(x, set, e.currentTarget)}
            onKeyDown={onRowKey}
            aria-expanded={open === `${set}:${x.id}`}
            aria-label={`${x.name}: ${x.left}; ${right}; ${word}${wait ? ' (checking)' : ''}. Show where this comes from`}
            title={`${x.name}: ${word}`}
          >
            <span className="dn">{x.name}</span>
            <span className="dl">{x.left}</span>
            <span className="dg" aria-hidden="true">
              <MarkIcon mark={mark} />
              <span className="w">{word}</span>
            </span>
            <span className="dv">{wait ? <span className="dim">reading…</span> : x.right ?? <span className="dr-unk">not shown here</span>}</span>
          </button>
        );
      })}
    </div>
  );
}

// ---- market ---------------------------------------------------------------------------------

/** Positions (0..100) of the band, median and price on a track padded 30% beyond p25–p75. */
export function trackPositions(m: MarketRef, priceMinor: number): { lo: number; hi: number; med: number; dot: number } {
  const lo = m.p25.minor;
  const hi = m.p75.minor;
  const span = Math.max(1, hi - lo);
  const min = lo - span * 0.3;
  const max = hi + span * 0.3;
  const pos = (x: number) => Math.max(0, Math.min(100, ((x - min) / (max - min)) * 100));
  return { lo: pos(lo), hi: pos(hi), med: pos(m.median.minor), dot: pos(priceMinor) };
}

/** "a bit above typical" for this deal's price, or null when the currencies differ. */
function priceWord(deal: Deal): ReturnType<typeof marketWords> | null {
  const m = deal.market;
  if (!m || deal.terms.unit_price.currency !== m.p25.currency) return null;
  return marketWords(deal.terms.unit_price.minor, m.p25.minor, m.median.minor, m.p75.minor);
}

export function MarketLine({ deal, onInfo }: { deal: Deal; onInfo: (el: HTMLElement) => void }) {
  const m = deal.market;
  if (!m) {
    return (
      <div className="dr-mkt">
        <span className="k">Market price</span>
        <span className="t">no reference for this item, so the price check was skipped</span>
      </div>
    );
  }
  const pct = marketPercentile(deal.terms.unit_price, m);
  const word = priceWord(deal);
  const p = trackPositions(m, deal.terms.unit_price.minor);
  return (
    <div className="dr-mkt">
      <span className="k">Market price</span>
      <span className="mini" aria-hidden="true">
        <span className="b" style={{ left: `${p.lo}%`, right: `${100 - p.hi}%` }} />
        <span className="m" style={{ left: `${p.med}%` }} />
        <span className="d" style={{ left: `${p.dot}%` }} />
      </span>
      <span className="t" title={pct !== null ? `Percentile ${pct} of comparable listings` : undefined}>
        {word ? <b className={`mw ${word.tone}`}>{word.text}</b> : <b>other currency</b>}
        <span className="dim"> · usually {formatMoney(m.p25)}–{formatMoney(m.p75)}</span>
      </span>
      <Btn kind="plain" sm aria-label="About the market price" onClick={(e) => onInfo(e.currentTarget)}>
        ⓘ
      </Btn>
    </div>
  );
}

export function MarketTrack({ deal }: { deal: Deal }) {
  const m = deal.market;
  if (!m) return <p className="pop-p">No market price for this item, so the price check was skipped, not passed.</p>;
  const p = trackPositions(m, deal.terms.unit_price.minor);
  const pct = marketPercentile(deal.terms.unit_price, m);
  const word = priceWord(deal);
  return (
    <>
      <p className="pop-p">
        {formatMoney(deal.terms.unit_price)} is <b>{word ? word.text : 'in another currency'}</b>. Comparable listings usually sell for {formatMoney(m.p25)}–{formatMoney(m.p75)}, typically {formatMoney(m.median)}.
      </p>
      <div className="dr-track" role="img" aria-label={`usual range ${formatMoney(m.p25)} to ${formatMoney(m.p75)}, typical ${formatMoney(m.median)}, this price ${formatMoney(deal.terms.unit_price)}`}>
        <span className="tr-band" style={{ left: `${p.lo}%`, right: `${100 - p.hi}%` }} />
        <span className="tr-med" style={{ left: `${p.med}%` }} />
        <span className="tr-dot" style={{ left: `${p.dot}%` }} />
        <span className="tr-t" style={{ left: `${p.lo}%` }}>{formatMoney(m.p25)}</span>
        <span className="tr-t" style={{ left: `${p.med}%` }}>{formatMoney(m.median)}</span>
        <span className="tr-t" style={{ left: `${p.hi}%` }}>{formatMoney(m.p75)}</span>
      </div>
      <p className="ui-hint">
        Checked {clockLabel(m.retrieved_at)}{m.cached ? ' (saved copy)' : ''}{pct !== null ? ` · percentile ${pct}` : ''}. A reference, not a verdict.
      </p>
    </>
  );
}

// ---- state ----------------------------------------------------------------------------------

const STEP_TONE: Record<Step['status'], ChipTone | undefined> = { cur: 'gold', ok: 'ok', bad: 'red', done: undefined, todo: undefined };

export function currentStep(steps: Step[]): { i: number; step: Step } {
  let i = steps.findIndex((s) => s.status !== 'done' && s.status !== 'todo');
  if (i < 0) i = steps.length - 1;
  return { i, step: steps[i] ?? { label: '—', status: 'todo' } };
}

/** Where the deal is: a status pill plus one dot per step (the dots, not "2/6", show progress). */
export function StateChip({ steps, onOpen }: { steps: Step[]; onOpen: (el: HTMLElement) => void }) {
  const { i, step } = currentStep(steps);
  return (
    <button type="button" className="dr-state" onClick={(e) => onOpen(e.currentTarget)} title="How far this deal has come"
      aria-label={`${step.label}, step ${i + 1} of ${steps.length}. Show the steps`}>
      <span className={cx('ui-chip', STEP_TONE[step.status])}>{step.label}</span>
      <span className="dots" aria-hidden="true">
        {steps.map((s, k) => <i key={k} className={s.status} />)}
      </span>
    </button>
  );
}

const STEP_GLYPH: Record<Step['status'], string> = { done: '✓', cur: '●', ok: '✓', bad: '✕', todo: '○' };

export function StateList({ steps, countdown }: { steps: Step[]; countdown?: ReactNode }) {
  return (
    <ol className="states">
      {steps.map((s, i) => (
        <li key={`${s.label}-${i}`} className={s.status} aria-current={s.status === 'cur' || s.status === 'bad' || s.status === 'ok' ? 'step' : undefined}>
          <span className="g" aria-hidden="true">{STEP_GLYPH[s.status]}</span>
          {s.label}
          {s.status === 'cur' && s.label === STEP.browser && countdown ? <> · {countdown}</> : null}
        </li>
      ))}
    </ol>
  );
}

// ---- footer ---------------------------------------------------------------------------------

/** "Offer ends in 3:57:54 · Tue 18:45" and "⧗ If you do nothing: …", one line each. */
export function Due({ label, deadline, silence }: { label: string | null; deadline: number | null; silence: string | null }) {
  if (!deadline && !silence) return null;
  return (
    <div className="dr-due">
      {deadline && label ? (
        <span className="dr-clock">
          {label} <b><Countdown deadline={deadline} /></b> <span className="dim">· {clockLabel(deadline)}</span>
        </span>
      ) : null}
      {silence ? (
        <span className="ui-silence wrap">
          <Hourglass /><span className="if">If you do nothing: </span><b>{silence}</b>
        </span>
      ) : null}
    </div>
  );
}
