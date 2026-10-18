// PriceCorridor: the haggle as two lines closing on each other inside Maya's signed range.
//
// Every figure comes from the take's run record (offersMaya, offersDan, ceiling, askAbove, gateAt);
// nothing is typed here. The record is read from the haggle beat that saw the most of the haggle
// (the take records each beat's state; the trade beat stops midway, the gate beat holds every
// offer), so the chart can tell the whole exchange while the trade beat's footage plays.
//
// Maya's offers (teal) rise, Dan's (coral) fall, each new one lands as a dot with its figure in
// tabular numerals, between the gold "ask me" line and the ceiling. When the offer the gate stopped
// on lands, the ask-me line flares gold and a gold hand-off runs toward the Tumbler.
//
// props: { mode: 'inset' | 'full' }
//   inset - a framed panel beside the footage (sandwich); when the same beat also runs a 'full'
//           corridor (led), the inset waits until it has gone and shows the settled chart.
//   full  - full-bleed chart that wipes in over the footage and wipes away to give it back.
//
// Frame-pure: everything is a function of the beat-local frame and the take, so the inset and the
// full chart agree frame for frame and a seek anywhere renders the same picture.
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { alpha, capsStyle, formatNumber, mix, prog, useStyle, type MomentCtx, type MomentProps, type Style } from '@film/kit';
import { NUMERALS } from './fonts.ts';

const CORAL = '#ff8f6b';

export type HaggleRecord = { offersMaya: number[]; offersDan: number[]; ceiling: number; askAbove: number; gateAt?: number };
type Pt = { x: number; y: number; v: number; side: 'maya' | 'dan'; k: number; land: number; gate: boolean };

const nums = (v: unknown): number[] | undefined =>
  Array.isArray(v) && v.every((n) => typeof n === 'number' && Number.isFinite(n)) ? (v as number[]) : undefined;
const numOf = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const money = (v: number) => `$${formatNumber(v, Number.isInteger(v) ? 0 : 2)}`;

/** The haggle record that saw the most offers, nearest to this beat, within its chapter. */
export function haggleRecord(ctx: MomentCtx): HaggleRecord | undefined {
  let best: { rec: HaggleRecord; score: number } | undefined;
  for (const b of ctx.timeline.beats) {
    if (b.chapter !== ctx.beat.chapter) continue;
    const r = b.takeBeat?.record;
    const offersMaya = nums(r?.offersMaya);
    const offersDan = nums(r?.offersDan);
    const ceiling = numOf(r?.ceiling);
    const askAbove = numOf(r?.askAbove);
    if (!offersMaya || !offersDan || ceiling === undefined || askAbove === undefined) continue;
    const gateAt = numOf(r?.gateAt);
    const score = (offersMaya.length + offersDan.length) * 1000 + (gateAt !== undefined ? 500 : 0) - Math.abs(b.index - ctx.beat.index);
    if (!best || score > best.score) best = { rec: { offersMaya, offersDan, ceiling, askAbove, ...(gateAt !== undefined ? { gateAt } : {}) }, score };
  }
  return best?.rec;
}

// ---- schedule, in beat-local frames (shared by inset and full so they agree)
const FIRST = 20; // first offer lands
const STEP = 10; // one offer every third of a second
const DRAW = 8; // a segment draws over this many frames before its dot lands
const FLARE = 22;

/** Chronological order: Dan lists, Maya answers, and so on (the record keeps each side in order). */
function events(rec: HaggleRecord) {
  const out: { v: number; side: 'maya' | 'dan'; k: number }[] = [];
  const n = Math.max(rec.offersDan.length, rec.offersMaya.length);
  for (let i = 0; i < n; i++) {
    if (i < rec.offersDan.length) out.push({ v: rec.offersDan[i], side: 'dan', k: i });
    if (i < rec.offersMaya.length) out.push({ v: rec.offersMaya[i], side: 'maya', k: i });
  }
  return out;
}

type Layout = {
  x0: number; x1: number; y0: number; y1: number;
  dot: number; fig: number; cap: number; stroke: number; ruleLabel: number; compact: boolean;
};

function geometry(rec: HaggleRecord, L: Layout) {
  const ev = events(rec);
  const all = [...rec.offersMaya, ...rec.offersDan, rec.ceiling, rec.askAbove];
  const lo0 = Math.min(...all);
  const hi0 = Math.max(...all);
  const pad = (hi0 - lo0) * 0.1;
  const lo = lo0 - pad;
  const hi = hi0 + pad * 0.8;
  const y = (v: number) => L.y1 - ((v - lo) / (hi - lo)) * (L.y1 - L.y0);
  const n = ev.length;
  const x = (i: number) => L.x0 + (n <= 1 ? 0.5 : i / (n - 1)) * (L.x1 - L.x0);
  const lastDan = rec.offersDan.length - 1;
  const pts: Pt[] = ev.map((e, i) => ({
    x: x(i), y: y(e.v), v: e.v, side: e.side, k: e.k, land: FIRST + i * STEP,
    gate: rec.gateAt !== undefined && e.side === 'dan' && e.k === lastDan && e.v === rec.gateAt,
  }));
  const gate = pts.find((p) => p.gate);
  return { pts, y, gate, end: FIRST + (n - 1) * STEP };
}

/** A side's polyline drawn up to frame t: whole segments, then the growing one. */
function path(side: Pt[], t: number): string {
  if (!side.length || t < side[0].land) return '';
  let d = `M ${side[0].x} ${side[0].y}`;
  for (let i = 1; i < side.length; i++) {
    const p = side[i];
    const a = side[i - 1];
    const q = clamp01((t - (p.land - DRAW)) / DRAW);
    if (q <= 0) break;
    d += ` L ${a.x + (p.x - a.x) * q} ${a.y + (p.y - a.y) * q}`;
  }
  return d;
}

function Chart({ rec, L, t, s, tumbler }: { rec: HaggleRecord; L: Layout; t: number; s: Style; tumbler?: { x: number; y: number } }) {
  const { pts, y, gate } = geometry(rec, L);
  const maya = pts.filter((p) => p.side === 'maya');
  const dan = pts.filter((p) => p.side === 'dan');
  const rulesP = prog(t, 0, 18, s.ease);
  const flare = gate ? prog(t, gate.land, FLARE, s.ease) : 0;
  const fade = gate ? 1 - 0.55 * prog(t, gate.land + FLARE, 30, s.ease) : 1;
  const glow = flare * fade;
  const gold = s.accent2;
  const yC = y(rec.ceiling);
  const yA = y(rec.askAbove);
  const w = L.x1 - L.x0;
  const lastLanded = (side: Pt[]) => side.filter((p) => t >= p.land).pop();
  const latest = [lastLanded(maya), lastLanded(dan)];
  const ruleX = L.x0 - (L.compact ? 14 : 24);
  const ruleW = w + (L.compact ? 28 : 48);
  const handP = gate && tumbler ? prog(t, gate.land + 10, 26, s.ease) : 0;

  return (
    <svg width={1920} height={1080} viewBox="0 0 1920 1080" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
      <defs>
        <filter id="pc-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={L.compact ? 5 : 9} />
        </filter>
        <linearGradient id="pc-range" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={s.accent} stopOpacity={0.1} />
          <stop offset="1" stopColor={s.accent} stopOpacity={0.03} />
        </linearGradient>
      </defs>

      {/* her range: from the ask-me line up to the ceiling */}
      <rect x={ruleX} y={yC} width={ruleW * rulesP} height={yA - yC} fill="url(#pc-range)" />
      {/* the ceiling */}
      <line x1={ruleX} x2={ruleX + ruleW * rulesP} y1={yC} y2={yC} stroke={alpha(s.fg, 0.55)} strokeWidth={L.compact ? 1.5 : 2} strokeDasharray={L.compact ? '6 6' : '10 9'} />
      {/* the ask-me line: quiet gold, flares when the gate lands */}
      <line x1={ruleX} x2={ruleX + ruleW * rulesP} y1={yA} y2={yA} stroke={gold} strokeWidth={(L.compact ? 6 : 10) * glow} opacity={0.55 * glow} filter="url(#pc-glow)" />
      <line x1={ruleX} x2={ruleX + ruleW * rulesP} y1={yA} y2={yA} stroke={mix(alpha(gold, 0.6), gold, glow)} strokeWidth={(L.compact ? 1.5 : 2) + glow * (L.compact ? 1.5 : 2.5)} />

      {/* the two sides */}
      {[{ side: dan, c: CORAL }, { side: maya, c: s.accent }].map(({ side, c }, j) => (
        <g key={j}>
          <path d={path(side, t)} fill="none" stroke={c} strokeWidth={L.stroke * 3} opacity={0.18} strokeLinecap="round" strokeLinejoin="round" filter="url(#pc-glow)" />
          <path d={path(side, t)} fill="none" stroke={c} strokeWidth={L.stroke} strokeLinecap="round" strokeLinejoin="round" />
        </g>
      ))}

      {/* dots */}
      {pts.map((p, i) => {
        const inP = prog(t, p.land - 2, 8, s.ease);
        if (inP <= 0) return null;
        const pop = 1 + 0.55 * Math.sin(Math.PI * clamp01((t - p.land + 2) / 10));
        const isLatest = latest.includes(p);
        const c = p.gate ? mix(CORAL, gold, flare) : p.side === 'maya' ? s.accent : CORAL;
        const r = L.dot * inP * (p.gate ? pop + 0.4 * flare : pop);
        const ring = p.gate ? prog(t, p.land, 28, s.ease) : 0;
        return (
          <g key={i}>
            {p.gate && ring > 0 && ring < 1 ? <circle cx={p.x} cy={p.y} r={L.dot * (1.2 + 4.5 * ring)} fill="none" stroke={gold} strokeWidth={L.compact ? 2 : 3} opacity={1 - ring} /> : null}
            <circle cx={p.x} cy={p.y} r={r + (L.compact ? 3 : 5)} fill={s.bg} opacity={isLatest ? 1 : 0.9} />
            <circle cx={p.x} cy={p.y} r={r} fill={isLatest || p.gate ? c : mix(c, s.bg, 0.35)} />
          </g>
        );
      })}

      {/* hand-off toward the Tumbler (inset, where the footage shows it) */}
      {gate && tumbler && handP > 0 ? (
        <g opacity={fade < 1 ? 0.6 + 0.4 * fade : 1}>
          <path
            d={`M ${gate.x} ${gate.y} C ${gate.x + 40} ${gate.y + 160}, ${tumbler.x + 10} ${tumbler.y - 180}, ${tumbler.x} ${tumbler.y}`}
            fill="none" stroke={gold} strokeWidth={2.5} pathLength={1} strokeDasharray={`${handP} 1`} strokeLinecap="round"
          />
          {handP >= 1 ? <circle cx={tumbler.x} cy={tumbler.y} r={44 + 30 * prog(t, gate.land + 36, 24, s.ease)} fill="none" stroke={gold} strokeWidth={3} opacity={1 - prog(t, gate.land + 36, 24, s.ease)} /> : null}
        </g>
      ) : null}
    </svg>
  );
}

/** HTML labels over the chart: figures in tabular numerals, rule labels, gate tag. */
function Labels({ rec, L, t, s }: { rec: HaggleRecord; L: Layout; t: number; s: Style }) {
  const { pts, y, gate } = geometry(rec, L);
  const flare = gate ? prog(t, gate.land, FLARE, s.ease) : 0;
  const rulesP = prog(t, 4, 18, s.ease);
  const gold = s.accent2;
  const lastOf = (side: 'maya' | 'dan') => pts.filter((p) => p.side === side && t >= p.land).pop();
  const latest = [lastOf('maya'), lastOf('dan')];
  const figStyle = { position: 'absolute' as const, fontFamily: NUMERALS, fontWeight: 650, fontVariantNumeric: 'tabular-nums lining-nums', letterSpacing: '-0.01em', lineHeight: 1, whiteSpace: 'nowrap' as const };
  return (
    <>
      {/* rule labels, inside her range at the left: the ceiling under its line, ask-me over its line */}
      {[
        { v: rec.ceiling, cap: L.compact ? 'Ceiling' : 'Her ceiling', c: alpha(s.fg, 0.86), capC: s.muted, glow: 0, below: true },
        { v: rec.askAbove, cap: L.compact ? 'Ask me above' : 'Ask me above', c: mix(alpha(gold, 0.8), gold, flare), capC: mix(alpha(gold, 0.75), gold, flare), glow: flare, below: false },
      ].map((r, i) => (
        <div
          key={i}
          style={{
            position: 'absolute', left: L.x0 - (L.compact ? 14 : 24) + (L.compact ? 10 : 18), top: y(r.v) + (r.below ? (L.compact ? 9 : 14) : -(L.compact ? 9 : 14)),
            transform: `translateY(${r.below ? '0' : '-100%'}) translateX(${(1 - rulesP) * -12}px)`, opacity: rulesP,
            display: 'flex', alignItems: 'baseline', gap: L.compact ? 8 : 14, whiteSpace: 'nowrap',
          }}
        >
          <span style={{ ...capsStyle(s, L.cap), color: r.capC, letterSpacing: '0.16em' }}>{r.cap}</span>
          <span style={{ ...figStyle, position: 'static', fontSize: L.ruleLabel, color: r.c, textShadow: r.glow ? `0 0 ${18 * r.glow}px ${alpha(gold, 0.6 * r.glow)}` : undefined }}>{money(r.v)}</span>
        </div>
      ))}

      {/* each offer's figure: Dan above his dot, Maya below hers; older figures step back */}
      {pts.map((p, i) => {
        const inP = prog(t, p.land, 9, s.ease) * (p.gate ? 1 - flare : 1);
        if (inP <= 0) return null;
        const isLatest = latest.includes(p);
        const above = p.side === 'dan';
        const off = (L.dot + (L.compact ? 9 : 14)) * (above ? -1 : 1);
        const c = p.gate ? mix(CORAL, gold, flare) : p.side === 'maya' ? mix(s.accent, s.fg, 0.25) : mix(CORAL, s.fg, 0.2);
        const size = L.fig * (isLatest || p.gate ? 1 : 0.8);
        return (
          <div
            key={i}
            style={{
              ...figStyle,
              left: p.x,
              top: p.y + off,
              fontSize: size,
              color: c,
              opacity: inP * (isLatest || p.gate ? 1 : 0.5),
              transform: `translate(-50%, ${above ? '-100%' : '0'}) translateY(${(1 - inP) * (above ? 10 : -10)}px)`,
            }}
          >
            {money(p.v)}
          </div>
        );
      })}

      {/* the gate tag on the offer the agent stopped at */}
      {gate && flare > 0 ? (
        <div
          style={{
            position: 'absolute',
            left: gate.x + (L.compact ? -12 : 0),
            top: gate.y - L.dot - (L.compact ? 58 : 118) - L.fig,
            transform: `translate(-${L.compact ? 88 : 50}%, ${(1 - flare) * 12}px)`,
            opacity: flare,
            background: gold,
            color: s.bg,
            borderRadius: 999,
            padding: L.compact ? '5px 12px' : '9px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: L.compact ? 7 : 12,
            whiteSpace: 'nowrap',
            boxShadow: `0 0 ${40 * flare}px ${alpha(gold, 0.45)}`,
          }}
        >
          <span style={{ ...capsStyle(s, L.compact ? 12 : 18), color: s.bg, letterSpacing: '0.14em', fontWeight: 700 }}>Ask her</span>
          <span style={{ fontFamily: NUMERALS, fontWeight: 750, fontSize: L.compact ? 17 : 26, fontVariantNumeric: 'tabular-nums lining-nums' }}>{money(gate.v)}</span>
        </div>
      ) : null}
    </>
  );
}

function Legend({ s, t, size, gap }: { s: Style; t: number; size: number; gap: number }) {
  const p = prog(t, 8, 16, s.ease);
  const item = (c: string, label: string) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.55 }}>
      <span style={{ width: size * 1.6, height: 3, borderRadius: 2, background: c }} />
      <span style={{ fontFamily: s.body, fontSize: size, fontWeight: 500, color: alpha(s.fg, 0.82) }}>{label}</span>
    </span>
  );
  return (
    <div style={{ display: 'flex', gap, opacity: p, transform: `translateY(${(1 - p) * 8}px)` }}>
      {item(s.accent, "Maya's agent")}
      {item(CORAL, 'Dan')}
    </div>
  );
}

/** The gap between the two latest offers, counting down as they close. */
function Gap({ rec, t, s, size }: { rec: HaggleRecord; t: number; s: Style; size: number }) {
  const ev = events(rec);
  let maya: number | undefined;
  let dan: number | undefined;
  let prevGap: number | undefined;
  let gap: number | undefined;
  let landedAt = 0;
  ev.forEach((e, i) => {
    const land = FIRST + i * STEP;
    if (t < land) return;
    if (e.side === 'maya') maya = e.v;
    else dan = e.v;
    if (maya !== undefined && dan !== undefined) {
      prevGap = gap;
      gap = dan - maya;
      landedAt = land;
    }
  });
  if (gap === undefined) return <span style={{ opacity: 0 }}>.</span>;
  const q = prog(t, landedAt, 8, s.ease);
  const shown = Math.round(prevGap === undefined ? gap : prevGap + (gap - prevGap) * q);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: size * 0.35 }}>
      <span style={{ ...capsStyle(s, size * 0.36), letterSpacing: '0.18em' }}>gap</span>
      <span style={{ fontFamily: NUMERALS, fontWeight: 650, fontSize: size, color: s.fg, fontVariantNumeric: 'tabular-nums lining-nums', minWidth: `${size * 2.1}px`, textAlign: 'right' }}>{money(shown)}</span>
    </span>
  );
}

// ---- the two modes

const FULL: Layout = { x0: 250, x1: 1660, y0: 330, y1: 900, dot: 11, fig: 34, cap: 18, stroke: 4, ruleLabel: 40, compact: false };
/** The inset panel in screen px (beside the framed Table, above the Tumbler). */
const PANEL = { x: 1268, y: 168, w: 600, h: 560 };
const INSET: Layout = { x0: PANEL.x + 56, x1: PANEL.x + PANEL.w - 56, y0: PANEL.y + 168, y1: PANEL.y + PANEL.h - 40, dot: 7, fig: 21, cap: 11, stroke: 3, ruleLabel: 24, compact: true };

function FullCorridor({ rec, ctx, f, s }: { rec: HaggleRecord; ctx: MomentCtx; f: number; s: Style }) {
  const t = ctx.moment.startFrame - ctx.beat.startFrame + f; // beat-local
  const wipeIn = ctx.enters ? prog(f, 0, 14, s.ease) : 1;
  const out = ctx.exits ? prog(f, ctx.durFrames - 16, 16, s.easeIn) : 0;
  const push = 1 + 0.03 * clamp01(f / Math.max(1, ctx.durFrames));
  const head = prog(t, 2, 18, s.ease);
  return (
    <AbsoluteFill style={{ clipPath: `inset(${(1 - wipeIn) * 100}% 0 ${out * 100}% 0)` }}>
      <AbsoluteFill style={{ background: `radial-gradient(ellipse 80% 70% at 45% 55%, ${mix(s.bg, s.fg, 0.05)} 0%, ${s.bg} 75%)` }} />
      <AbsoluteFill style={{ transform: `scale(${push})`, transformOrigin: '42% 60%' }}>
        <div style={{ position: 'absolute', left: FULL.x0 - 24, top: 132, right: 160, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', opacity: head, transform: `translateY(${(1 - head) * 14}px)` }}>
          <div>
            <div style={{ ...capsStyle(s, 20), marginBottom: 14 }}>The haggle · every offer signed</div>
            <Legend s={s} t={t} size={26} gap={40} />
          </div>
          <Gap rec={rec} t={t} s={s} size={64} />
        </div>
        <Chart rec={rec} L={FULL} t={t} s={s} />
        <Labels rec={rec} L={FULL} t={t} s={s} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function InsetCorridor({ rec, ctx, f, s }: { rec: HaggleRecord; ctx: MomentCtx; f: number; s: Style }) {
  const t = ctx.moment.startFrame - ctx.beat.startFrame + f; // beat-local
  // in led, a full corridor plays first in this beat: the inset waits for it and arrives settled
  const full = ctx.timeline.moments.find((m) => m.beatId === ctx.beat.id && m.component === ctx.moment.component && m.id !== ctx.moment.id && m.props.mode === 'full');
  const from = full ? full.startFrame + full.durFrames - ctx.moment.startFrame : 0;
  if (f < from) return null;
  const local = f - from;
  const inP = prog(local, full ? 0 : 4, 16, s.ease);
  const out = ctx.exits ? prog(f, ctx.durFrames - 12, 12, s.easeIn) : 0;
  const p = inP * (1 - out);
  // the Tumbler on screen, through the same camera the footage uses
  const tb = ctx.rect('tumbler|.puck-art');
  const tumbler = tb ? ctx.toScreen({ x: tb.x + tb.w / 2, y: tb.y + tb.h / 2 }, f) : undefined;
  return (
    <AbsoluteFill style={{ opacity: p, transform: `translateX(${(1 - p) * 40}px)` }}>
      <div
        style={{
          position: 'absolute', left: PANEL.x, top: PANEL.y, width: PANEL.w, height: PANEL.h,
          background: alpha(s.bg, 0.94),
          border: `1px solid ${alpha(s.fg, 0.12)}`,
          borderRadius: s.radius * 1.4,
          boxShadow: `0 40px 90px ${alpha('#000000', 0.55)}, 0 0 0 1px ${alpha(s.bg, 0.6)}`,
        }}
      >
        <div style={{ position: 'absolute', left: 32, right: 32, top: 28, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ ...capsStyle(s, 13), letterSpacing: '0.2em', marginBottom: 12 }}>Every offer, signed</div>
            <Legend s={s} t={t} size={17} gap={22} />
          </div>
          <Gap rec={rec} t={t} s={s} size={38} />
        </div>
        <div style={{ position: 'absolute', left: 32, right: 32, top: 106, height: 1, background: alpha(s.fg, 0.08) }} />
      </div>
      <Chart rec={rec} L={INSET} t={t} s={s} tumbler={tumbler} />
      <Labels rec={rec} L={INSET} t={t} s={s} />
    </AbsoluteFill>
  );
}

export function PriceCorridor({ props, ctx }: MomentProps<{ mode?: 'inset' | 'full' }>) {
  const f = useCurrentFrame();
  const s = useStyle();
  const rec = haggleRecord(ctx);
  if (!rec) return null; // no record: no figures to show, and none are ever invented
  return props.mode === 'full' ? <FullCorridor rec={rec} ctx={ctx} f={f} s={s} /> : <InsetCorridor rec={rec} ctx={ctx} f={f} s={s} />;
}
