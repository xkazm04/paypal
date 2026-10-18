// DeadlineClock: every deadline of Maya's week on one clock. A playhead sweeps the week; each deadline
// burns down its fuse (time left, counted from the record's own deadlineAt), and as the playhead crosses
// it the amount at stake drains to what actually moved and the outcome (lapsed / released) is stamped.
// The total at the foot is reduced from the same record: "Nothing paid." only when nothing moved.
//
// props: { mode: 'full', utcOffsetMin?: number }
//   mode          the only mode; the film shows it full screen at the silence chapter's peak
//   utcOffsetMin  the story's clock for day and time labels (default -480: the capture's default zone,
//                 America/Los_Angeles in November). An ISO that carries its own offset uses that one.
// data:  ctx.record('deadlines') - [{ deal, label, amount, kind: 'offer'|'hold', deadlineAt (ISO),
//        outcome: 'open'|'lapsed'|'released', moved }]. No record: nothing is drawn, no figure is invented.
//        Any number of rows: the layout tightens past five.
//
// Frame-pure: a function of the moment-local frame, props and the take record only; times are computed
// from the ISO fields and the offset, never from the machine's time zone.
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { alpha, capsStyle, formatNumber, mix, prog, useStyle, type MomentCtx, type MomentProps, type Style } from '@film/kit';
import { NUMERALS } from '../../shared/fonts.ts';

type Outcome = 'open' | 'lapsed' | 'released';
export type Deadline = { deal: string; label: string; amount: number; kind: 'offer' | 'hold'; deadlineAt: string; outcome: Outcome; moved: number };
type Row = Deadline & { t: number };

const MIN_PER_DAY = 1440;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DEFAULT_OFFSET = -480;
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const money = (v: number) => `$${formatNumber(v, Number.isInteger(v) ? 0 : 2)}`;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Minutes since the epoch on the story's wall clock: the ISO's instant shifted by its own offset, else by `fallback`. */
function wallMinutes(iso: string, fallback: number): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|([+-])(\d{2}):?(\d{2}))?$/.exec(iso);
  if (!m) return undefined;
  const fields = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)) / 60000;
  if (m[7] && m[7] !== 'Z') return Math.round(fields); // already the zone's own wall clock
  return Math.round(fields + fallback); // UTC (or unzoned, read as UTC) -> story clock
}
function dayLabel(min: number): { day: string; date: number } {
  const d = new Date(min * 60000);
  return { day: DAYS[d.getUTCDay()], date: d.getUTCDate() };
}
function clockLabel(min: number): string {
  const d = new Date(min * 60000);
  return `${DAYS[d.getUTCDay()]} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
function leftLabel(min: number): string {
  if (min <= 0) return '0m';
  const d = Math.floor(min / MIN_PER_DAY);
  const h = Math.floor((min % MIN_PER_DAY) / 60);
  const m = Math.floor(min % 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

export function deadlineRows(ctx: MomentCtx, offset = DEFAULT_OFFSET): Row[] | undefined {
  const raw = ctx.record('deadlines');
  if (!Array.isArray(raw)) return undefined;
  const rows: Row[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || typeof r.deadlineAt !== 'string' || !isNum(r.amount) || !isNum(r.moved)) continue;
    const t = wallMinutes(r.deadlineAt, offset);
    if (t === undefined) continue;
    const outcome: Outcome = r.outcome === 'lapsed' || r.outcome === 'released' ? r.outcome : 'open';
    rows.push({
      deal: String(r.deal ?? ''), label: String(r.label ?? r.deal ?? ''), amount: r.amount, kind: r.kind === 'hold' ? 'hold' : 'offer',
      deadlineAt: r.deadlineAt, outcome, moved: r.moved, t,
    });
  }
  rows.sort((a, b) => a.t - b.t);
  return rows.length ? rows : undefined;
}

// ---- layout (screen px)
const AX0 = 860;
const AX1 = 1730;
const LEFT = 160;
const TOP = 300;
const BOTTOM = 856;

type Sizes = { amount: number; title: number; caps: number; stamp: number; marker: number; fuse: number; strike: number };
const ROOMY: Sizes = { amount: 46, title: 24, caps: 13, stamp: 24, marker: 11, fuse: 6, strike: 20 };
const DENSE: Sizes = { amount: 30, title: 20, caps: 11, stamp: 19, marker: 8, fuse: 4, strike: 0 };

export function DeadlineClock({ props, ctx }: MomentProps<{ mode?: 'full'; utcOffsetMin?: number }>) {
  const f = useCurrentFrame();
  const s = useStyle();
  const rows = deadlineRows(ctx, isNum(props.utcOffsetMin) ? props.utcOffsetMin : DEFAULT_OFFSET);
  if (!rows) return null;
  const D = ctx.durFrames;
  const dense = rows.length > 5;
  const Z = dense ? DENSE : ROOMY;

  // the week: midnight of the first deadline's day to midnight after the last one's
  const day0 = Math.floor(rows[0].t / MIN_PER_DAY) * MIN_PER_DAY;
  const dayN = Math.floor(rows[rows.length - 1].t / MIN_PER_DAY) * MIN_PER_DAY + MIN_PER_DAY;
  const days = Math.max(1, Math.round((dayN - day0) / MIN_PER_DAY));
  const xOf = (t: number) => AX0 + ((t - day0) / (dayN - day0)) * (AX1 - AX0);
  // the sweep stops two hours past the last deadline that resolved (an open one is never shown resolved)
  const open = rows.filter((r) => r.outcome === 'open');
  const resolved = rows.filter((r) => r.outcome !== 'open');
  const sweepTo = resolved.length ? Math.min(dayN, Math.max(...resolved.map((r) => r.t)) + 120) : day0;
  const S0 = 22;
  const S1 = Math.max(S0 + 30, D - 78);
  const sweep = prog(f, S0, S1 - S0, (t) => t * t * (3 - 2 * t));
  const now = day0 + (sweepTo - day0) * sweep;
  const nowX = xOf(now);

  const rowH = Math.min(132, (BOTTOM - TOP) / rows.length);
  const yOf = (i: number) => TOP + rowH * (i + 0.5);

  const wipeIn = ctx.enters ? prog(f, 0, 14, s.ease) : 1;
  const out = ctx.exits ? prog(f, D - 16, 16, s.easeIn) : 0;
  const head = prog(f, 4, 18, s.ease);
  const axisP = prog(f, 8, 22, s.ease);

  const stake = rows.reduce((a, r) => a + r.amount, 0);
  const moved = rows.reduce((a, r) => a + r.moved, 0);
  const allDone = open.length === 0;
  const footP = prog(f, S1 + 2, 20, s.ease);
  /** The frame the eased playhead crosses time t (so drains and stamps land on the crossing). */
  const crossFrame = (t: number) => S0 + inverseSmooth(clamp01((t - day0) / Math.max(1, sweepTo - day0))) * (S1 - S0);
  const lapsed = rows.filter((r) => r.outcome === 'lapsed').length;
  const released = rows.filter((r) => r.outcome === 'released').length;

  return (
    <AbsoluteFill style={{ clipPath: `inset(${(1 - wipeIn) * 100}% 0 ${out * 100}% 0)` }}>
      <AbsoluteFill style={{ background: `radial-gradient(ellipse 85% 70% at 55% 50%, ${mix(s.bg, s.fg, 0.05)} 0%, ${s.bg} 78%)` }} />

      {/* header: what this is, and the clock the playhead reads */}
      <div style={{ position: 'absolute', left: LEFT, right: 160, top: 96, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', opacity: head, transform: `translateY(${(1 - head) * 14}px)` }}>
        <div>
          <div style={{ ...capsStyle(s, 20), marginBottom: 12 }}>Every deadline this week</div>
          <div style={{ fontFamily: s.display, fontWeight: 600, fontSize: 52, color: s.fg, letterSpacing: '-0.02em' }}>Nobody answered. What moved?</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ ...capsStyle(s, 15), marginBottom: 6 }}>Clock</div>
          <div style={{ fontFamily: NUMERALS, fontVariantNumeric: 'tabular-nums lining-nums', fontWeight: 600, fontSize: 52, color: s.accent2, letterSpacing: '0.01em' }}>{clockLabel(now)}</div>
        </div>
      </div>

      <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
        {/* day grid */}
        {Array.from({ length: days + 1 }, (_, k) => {
          const x = AX0 + (k / days) * (AX1 - AX0);
          return <line key={k} x1={x} x2={x} y1={TOP - 20} y2={TOP - 20 + (BOTTOM - TOP + 20) * axisP} stroke={alpha(s.fg, k === 0 || k === days ? 0.14 : 0.07)} strokeWidth={1} />;
        })}
        {/* tracks, fuses, markers */}
        {rows.map((r, i) => {
          const y = yOf(i);
          const x = xOf(r.t);
          const rowIn = prog(f, 10 + i * (dense ? 2 : 4), 18, s.ease);
          const crossed = now >= r.t;
          const settled = r.outcome !== 'open' && crossed;
          const k = Z.marker;
          return (
            <g key={r.deal + i} opacity={rowIn}>
              <line x1={AX0} x2={AX0 + (AX1 - AX0) * axisP} y1={y} y2={y} stroke={alpha(s.fg, 0.1)} strokeWidth={2} />
              {!crossed ? <line x1={Math.max(AX0, nowX)} x2={x} y1={y} y2={y} stroke={s.accent2} strokeWidth={Z.fuse} strokeLinecap="round" opacity={0.9} /> : null}
              {settled ? (
                <>
                  <circle cx={x} cy={y} r={k * 1.45} fill={alpha(s.accent, 0.16)} stroke={s.accent} strokeWidth={dense ? 2.5 : 3} />
                  <path d={`M ${x - k * 0.64} ${y} L ${x - k * 0.18} ${y + k * 0.55} L ${x + k * 0.72} ${y - k * 0.55}`} fill="none" stroke={s.accent} strokeWidth={dense ? 2.5 : 3} strokeLinecap="round" strokeLinejoin="round" />
                </>
              ) : (
                <rect x={x - k} y={y - k} width={2 * k} height={2 * k} transform={`rotate(45 ${x} ${y})`} fill={s.bg} stroke={s.accent2} strokeWidth={dense ? 2.5 : 3} />
              )}
            </g>
          );
        })}
        {/* playhead */}
        <line x1={nowX} x2={nowX} y1={TOP - 20} y2={BOTTOM} stroke={alpha(s.accent2, 0.85 * axisP)} strokeWidth={2} />
        <circle cx={nowX} cy={TOP - 20} r={6} fill={s.accent2} opacity={axisP} />
      </svg>

      {/* day labels */}
      {Array.from({ length: days }, (_, k) => {
        const d = dayLabel(day0 + k * MIN_PER_DAY + 1);
        const x = AX0 + ((k + 0.5) / days) * (AX1 - AX0);
        return (
          <div key={k} style={{ position: 'absolute', left: x - 80, width: 160, top: TOP - 60, textAlign: 'center', ...capsStyle(s, 15), letterSpacing: '0.16em', opacity: axisP }}>
            {d.day} {d.date}
          </div>
        );
      })}

      {/* per row: the left column (what, how much) and the countdown / outcome by the marker */}
      {rows.map((r, i) => {
        const y = yOf(i);
        const x = xOf(r.t);
        const rowIn = prog(f, 10 + i * (dense ? 2 : 4), 18, s.ease);
        const crossed = now >= r.t;
        const settled = r.outcome !== 'open' && crossed;
        const cf = crossFrame(r.t);
        const drain = settled ? prog(f, cf, 12, s.ease) : 0;
        const stamp = settled ? prog(f, cf + 4, 14, s.ease) : 0;
        const shown = r.amount + (r.moved - r.amount) * drain;
        const nearRight = x > AX1 - 300;
        const side = nearRight ? { right: 1920 - x + Z.marker * 2.6 } : { left: x + Z.marker * 2.6 };
        const amountW = dense ? 112 : 150;
        return (
          <div key={r.deal + i} style={{ opacity: rowIn, transform: `translateX(${(1 - rowIn) * -24}px)` }}>
            <div style={{ position: 'absolute', left: LEFT, top: y - rowH / 2, height: rowH, width: AX0 - LEFT - 40, display: 'flex', alignItems: 'center', gap: dense ? 18 : 22 }}>
              <div style={{ width: amountW, flex: 'none', textAlign: 'right', fontFamily: NUMERALS, fontVariantNumeric: 'tabular-nums lining-nums', lineHeight: 1 }}>
                <div style={{ fontWeight: 650, fontSize: Z.amount, color: mix(s.fg, s.muted, drain), letterSpacing: '-0.01em' }}>{money(Math.round(shown * 100) / 100)}</div>
                {Z.strike ? <div style={{ fontSize: Z.strike, color: s.muted, marginTop: 6, textDecoration: 'line-through', opacity: drain * 0.9 }}>{money(r.amount)}</div> : null}
              </div>
              <div style={{ minWidth: 0, display: 'flex', flexDirection: dense ? 'row' : 'column', alignItems: dense ? 'baseline' : 'flex-start', gap: dense ? 14 : 6 }}>
                <div style={{ ...capsStyle(s, Z.caps), letterSpacing: '0.16em', color: r.kind === 'hold' ? s.accent2 : s.muted, flex: 'none', width: dense ? 58 : undefined }}>
                  {r.kind === 'hold' ? (dense ? 'Hold' : 'Hold at PayPal') : 'Offer'}{dense ? '' : ` · ${r.deal}`}
                </div>
                <div style={{ fontFamily: s.body, fontSize: Z.title, color: s.fg, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                  {r.label}
                  {dense ? <span style={{ fontFamily: NUMERALS, fontSize: Z.title * 0.8, color: s.muted, marginLeft: 12 }}>{r.deal}</span> : null}
                </div>
              </div>
            </div>
            {!crossed && x > nowX + 40 ? (
              <div style={{ position: 'absolute', top: y - (dense ? 30 : 46), ...(nearRight ? { right: 1920 - x - 8 } : { left: x - 200, width: 400, textAlign: 'center' as const }), fontFamily: NUMERALS, fontVariantNumeric: 'tabular-nums lining-nums', fontWeight: 600, fontSize: dense ? 16 : 20, color: s.accent2, opacity: axisP, whiteSpace: 'nowrap' }}>
                {leftLabel(r.t - now)} left
              </div>
            ) : null}
            {settled ? (
              <div style={{ position: 'absolute', top: y - Z.stamp * 0.72, ...side, whiteSpace: 'nowrap', display: 'flex', alignItems: 'baseline', gap: 10, opacity: stamp, transform: `translateY(${(1 - stamp) * 8}px)` }}>
                <span style={{ ...capsStyle(s, Z.caps + 2), color: s.accent, letterSpacing: '0.18em' }}>{r.outcome === 'lapsed' ? 'Lapsed' : 'Released'}</span>
                <span style={{ fontFamily: NUMERALS, fontVariantNumeric: 'tabular-nums lining-nums', fontWeight: 600, fontSize: Z.stamp, color: s.fg }}>{money(r.moved)} moved</span>
              </div>
            ) : null}
          </div>
        );
      })}

      {/* the total, reduced from the record */}
      <div style={{ position: 'absolute', left: LEFT, right: 160, top: 898, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', opacity: footP, transform: `translateY(${(1 - footP) * 16}px)` }}>
        <div style={{ fontFamily: s.display, fontWeight: 700, fontSize: 84, letterSpacing: '-0.03em', color: moved === 0 ? s.accent : s.fg }}>
          {moved === 0 ? (allDone ? 'Nothing paid.' : 'Nothing paid yet.') : `${money(moved)} moved.`}
        </div>
        <div style={{ fontFamily: NUMERALS, fontVariantNumeric: 'tabular-nums lining-nums', fontSize: 28, color: s.muted, textAlign: 'right', lineHeight: 1.45 }}>
          <div><span style={{ color: s.fg, fontWeight: 650 }}>{money(moved)}</span> moved of {money(stake)} at stake</div>
          <div>{rows.length} deadline{rows.length === 1 ? '' : 's'}{lapsed ? ` · ${lapsed} lapsed` : ''}{released ? ` · ${released} released` : ''}{open.length ? ` · ${open.length} still open` : ''}</div>
        </div>
      </div>
    </AbsoluteFill>
  );
}

/** Inverse of smoothstep on [0,1] (so a row knows the frame the eased playhead crosses it). */
function inverseSmooth(y: number): number {
  return 0.5 - Math.sin(Math.asin(1 - 2 * clamp01(y)) / 3);
}
