// The convergence chart (signed offers inside the band) and the market band. Both render with a
// viewBox equal to their pixel size, so chart text stays at a real 13 px at every window size.
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { MarketRef } from '@bindings/MarketRef';
import type { Money } from '@bindings/Money';
import { formatMinor } from '../../lib/format';
import { marketWords } from '../../lib/words';
import type { DealDisplay } from '@bindings/DealDisplay';
import type { TranscriptStep } from '@bindings/TranscriptStep';
import { usePrefersReducedMotion } from '../../lib/hooks';
import { marketPosition, niceTicks } from './logic';
import './charts.css';

function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((es) => { const cw = es[0]?.contentRect.width ?? 0; setW(Math.round(cw)); });
    ro.observe(el);
    setW(Math.round(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

type Props = {
  steps: TranscriptStep[];
  band: DealDisplay['band'];
  market: MarketRef | null;
  height?: number;
  theirName: string;
  settled: boolean;
};

export function ConvergenceChart({ steps, band, market, height = 300, theirName, settled }: Props) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const reduced = usePrefersReducedMotion();
  const priced = steps.filter((s): s is TranscriptStep & { price: Money } => s.price !== null);
  const cur = priced[0]?.price.currency ?? market?.median.currency ?? 'USD';
  const values = [...priced.map((s) => s.price.minor)];
  if (band?.ceiling) values.push(band.ceiling.minor);
  if (band?.floor) values.push(band.floor.minor);
  if (market) values.push(market.p25.minor, market.p75.minor);
  const H = height;
  const L = 64; const Rr = 92; const T = 22; const B = 34;
  if (!priced.length) return <div className="empty">No offers yet. The chart fills in as offers arrive.</div>;
  const { lo, hi, ticks } = niceTicks(Math.min(...values), Math.max(...values));
  const plotW = Math.max(40, W - L - Rr);
  const maxSeq = Math.max(...priced.map((s) => s.seq));
  const minSeq = Math.min(...priced.map((s) => s.seq));
  const x = (seq: number) => L + (maxSeq === minSeq ? plotW / 2 : ((seq - minSeq) / (maxSeq - minSeq)) * plotW);
  const y = (minor: number) => T + ((hi - minor) / (hi - lo)) * (H - T - B);
  const fm = (m: number) => formatMinor(m, cur).replace(/\.00$/, '');
  const path = (arr: typeof priced) => arr.map((s, i) => `${i ? 'L' : 'M'}${x(s.seq).toFixed(1)} ${y(s.price.minor).toFixed(1)}`).join(' ');
  const yours = priced.filter((s) => s.by === 'you');
  const theirs = priced.filter((s) => s.by === 'them');
  const last = priced.reduce((a, b) => (b.seq > a.seq ? b : a));
  const ceil = band?.ceiling?.minor ?? null;
  const floor = band?.floor?.minor ?? null;
  const fits = (ceil === null || last.price.minor <= ceil) && (floor === null || last.price.minor >= floor);
  const bandTop = ceil ?? hi;
  const bandBottom = floor ?? lo;
  const unverified = priced.some((s) => !s.verified);

  return (
    <div className="chartbox" ref={ref}>
      {W > 0 ? (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img"
          aria-label={`Offers coming together. ${ceil !== null ? `Most you’ll pay ${fm(ceil)}. ` : ''}Latest offer from ${last.by === 'you' ? 'you' : theirName}: ${fm(last.price.minor)}.`}>
          <defs>
            <pattern id="cv-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" className="cv-hatch" strokeWidth="3" /></pattern>
            <linearGradient id="cv-band" x1="0" y1="0" x2="0" y2="1"><stop offset="0" className="cv-stop" stopOpacity=".28" /><stop offset="1" className="cv-stop" stopOpacity=".04" /></linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={L} x2={W - Rr} y1={y(t)} y2={y(t)} className="cv-grid" />
              <text x={L - 8} y={y(t) + 4} textAnchor="end" className="ax">{fm(t)}</text>
            </g>
          ))}
          {band ? <rect x={L} y={y(bandTop)} width={plotW} height={Math.max(0, y(bandBottom) - y(bandTop))} fill="url(#cv-band)" /> : null}
          {market ? (
            <>
              <rect x={L} y={y(market.p75.minor)} width={plotW} height={Math.max(0, y(market.p25.minor) - y(market.p75.minor))} fill="url(#cv-hatch)" />
              <text x={W - Rr - 8} y={y(market.p25.minor) + 17 < H - B - 2 ? y(market.p25.minor) + 17 : y(market.p75.minor) - 6} textAnchor="end" className="ax mk">typical {fm(market.p25.minor)}–{fm(market.p75.minor)}</text>
            </>
          ) : null}
          <path d={path(theirs)} className="cv-them" strokeWidth="2" fill="none" opacity=".8" />
          <path d={path(yours)} className="cv-you" strokeWidth="2" fill="none" opacity=".8" />
          {theirs.map((s) => <circle key={s.seq} cx={x(s.seq)} cy={y(s.price.minor)} r="5" className="cv-dot-them"><title>{`${theirName} ${s.typ === 'LISTING' ? 'listed it at' : 'offered'} ${fm(s.price.minor)}${s.verified ? ' · signature checked' : ' · signature could not be checked'}`}</title></circle>)}
          {yours.map((s) => <circle key={s.seq} cx={x(s.seq)} cy={y(s.price.minor)} r="5" className="cv-dot-you"><title>{`You ${s.typ === 'ACCEPT' ? 'accepted' : 'offered'} ${fm(s.price.minor)}${s.verified ? ' · signature checked' : ' · signature could not be checked'}`}</title></circle>)}
          <circle className={`cv-last ${fits ? 'fits' : ''} ${fits && !settled && !reduced ? 'pulse-ring' : ''}`} cx={x(last.seq)} cy={y(last.price.minor)} r="10" fill="none" strokeWidth="3" />
          <text x={x(last.seq) + (fits ? 15 : -15)} y={y(last.price.minor) + (fits ? 5 : 24)} textAnchor={fits ? 'start' : 'end'} className={`ax strong ${fits ? 'gold' : ''}`}>{fm(last.price.minor)}{fits ? '' : ' · outside your range'}</text>
          {ceil !== null ? (
            <>
              <line x1={L} x2={W - Rr + 6} y1={y(ceil)} y2={y(ceil)} className="cv-limit" strokeWidth="2.5" />
              <rect x={W - Rr + 8} y={y(ceil) - 14} width={Rr - 12} height="28" rx="14" className="cv-tag" />
              <text x={W - Rr / 2 + 2} y={y(ceil) + 5} textAnchor="middle" className="ax tag">{fm(ceil)}</text>
              <text x={W - Rr + 8} y={y(ceil) - 20} className="ax teal">your max</text>
            </>
          ) : null}
          {floor !== null ? (
            <>
              <line x1={L} x2={W - Rr + 6} y1={y(floor)} y2={y(floor)} className="cv-limit" strokeWidth="2.5" strokeDasharray="6 4" />
              <text x={W - Rr + 8} y={y(floor) + 18} className="ax teal">your min {fm(floor)}</text>
            </>
          ) : null}
          <text x={L} y={H - 9} className="ax">first offer → latest{unverified ? ' · some signatures could not be checked' : ''}</text>
        </svg>
      ) : null}
    </div>
  );
}

/** The market band (p25 / median / p75) with the deal's own price placed on it, and the signed
 *  ceiling (or floor) as a dashed line when one is given. */
export function MarketBand({ market, price, limit }: { market: MarketRef; price: Money | null; limit?: { label: string; value: Money } | null }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const cur = market.median.currency;
  const fm = (m: number) => formatMinor(m, cur);
  const priced = price && price.currency === cur ? price : null;
  const lim = limit && limit.value.currency === cur ? limit : null;
  const pts = [market.p25.minor, market.p75.minor, ...(priced ? [priced.minor] : []), ...(lim ? [lim.value.minor] : [])];
  const span = Math.max(...pts) - Math.min(...pts) || 1;
  const lo = Math.min(...pts) - span * 0.18;
  const hi = Math.max(...pts) + span * 0.18;
  const H = 74; const pad = 16;
  const x = (m: number) => pad + ((m - lo) / (hi - lo)) * (W - 2 * pad);
  const pos = priced ? marketPosition(priced.minor, market.p25.minor, market.median.minor, market.p75.minor) : null;
  const wpos = priced ? marketWords(priced.minor, market.p25.minor, market.median.minor, market.p75.minor).text : null;
  return (
    <div className="chartbox market" ref={ref}>
      {W > 0 ? (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img"
          aria-label={`Typical price ${fm(market.p25.minor)} to ${fm(market.p75.minor)}, middle ${fm(market.median.minor)}${priced ? `; this deal ${fm(priced.minor)}, ${pos}` : ''}${lim ? `; ${lim.label} ${fm(lim.value.minor)}` : ''}`}>
          <line x1={pad} x2={W - pad} y1="40" y2="40" className="mb-axis" strokeWidth="2" />
          <rect x={x(market.p25.minor)} y="30" width={Math.max(2, x(market.p75.minor) - x(market.p25.minor))} height="20" rx="4" className="mb-box" />
          <line x1={x(market.median.minor)} x2={x(market.median.minor)} y1="26" y2="54" className="mb-median" strokeWidth="2" />
          <text x={x(market.p25.minor) - 6} y="68" textAnchor="end" className="ax">{fm(market.p25.minor)}</text>
          <text x={x(market.median.minor)} y="68" textAnchor="middle" className="ax mk">middle {fm(market.median.minor)}</text>
          <text x={x(market.p75.minor) + 6} y="68" textAnchor="start" className="ax">{fm(market.p75.minor)}</text>
          {lim ? (
            <g>
              <line x1={x(lim.value.minor)} x2={x(lim.value.minor)} y1="24" y2="50" className="mb-limit" strokeWidth="2" strokeDasharray="3 3" />
              <text x={x(lim.value.minor) + (x(lim.value.minor) > W - 150 ? -6 : 6)} y="18" textAnchor={x(lim.value.minor) > W - 150 ? 'end' : 'start'} className="ax teal">{lim.label} {fm(lim.value.minor)}</text>
            </g>
          ) : null}
          {priced ? (
            <g>
              <circle cx={x(priced.minor)} cy="40" r="7" className="mb-price" strokeWidth="2" />
              {lim ? null : <text x={x(priced.minor) + (x(priced.minor) > W - 150 ? -12 : 12)} y="18" textAnchor={x(priced.minor) > W - 150 ? 'end' : 'start'} className="ax strong gold">this deal {fm(priced.minor)}{wpos ? ` · ${wpos}` : ''}</text>}
            </g>
          ) : null}
        </svg>
      ) : null}
    </div>
  );
}

/** A 120 x 18 band glyph for an indicator row: p25-p75 box, median tick, the deal's price dot. */
export function MiniBand({ market, price, limit }: { market: MarketRef; price: Money | null; limit?: Money | null }) {
  const cur = market.median.currency;
  const p = price && price.currency === cur ? price.minor : null;
  const l = limit && limit.currency === cur ? limit.minor : null;
  const vals = [market.p25.minor, market.p75.minor, ...(p !== null ? [p] : []), ...(l !== null ? [l] : [])];
  const span = Math.max(...vals) - Math.min(...vals) || 1;
  const lo = Math.min(...vals) - span * 0.15;
  const hi = Math.max(...vals) + span * 0.15;
  const x = (v: number) => 4 + ((v - lo) / (hi - lo)) * 112;
  return (
    <svg className="miniband" viewBox="0 0 120 18" width="120" height="18" aria-hidden="true">
      <line x1="2" x2="118" y1="9" y2="9" className="mb-axis" />
      <rect x={x(market.p25.minor)} y="4" width={Math.max(2, x(market.p75.minor) - x(market.p25.minor))} height="10" rx="2" className="mb-box" />
      <line x1={x(market.median.minor)} x2={x(market.median.minor)} y1="2" y2="16" className="mb-median" strokeWidth="1.5" />
      {l !== null ? <line x1={x(l)} x2={x(l)} y1="1" y2="17" className="mb-limit" strokeDasharray="2 2" /> : null}
      {p !== null ? <circle cx={x(p)} cy="9" r="4" className="mb-price" /> : null}
    </svg>
  );
}
