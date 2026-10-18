// WhoDecided: the week's money steps as the Rewind counts them, each flowing from the record into the
// lane of whoever decided it - her signed rules (her agent acting inside them), Maya herself, a deadline's
// safe default, or a refusal before PayPal was asked. A step that moved money is lit; the rest are drawn
// open. Each lane totals its steps and what it paid, and the recap is reduced from the same record:
// what moved and under whose authority, against how many steps moved nothing.
//
// props: { mode: 'full' }   (the only mode; the film shows it full screen at the proof chapter's peak)
// data:  ctx.record('decisions') - [{ deal, step, amount, decidedBy: 'agent'|'deadline'|'owner'|'refused',
//        paid, at (ISO) }]. No record: nothing is drawn, no figure is invented. Any number of steps: the
//        tiles shrink to fit the fullest lane.
//
// Frame-pure: a function of the moment-local frame and the take record only.
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { alpha, capsStyle, formatNumber, mix, prog, useStyle, type MomentCtx, type MomentProps, type Style } from '@film/kit';
import { NUMERALS } from '../../shared/fonts.ts';

type Who = 'agent' | 'deadline' | 'owner' | 'refused';
export type Decision = { deal: string; step: string; amount: number; decidedBy: Who; paid: boolean; at: string };
type Item = Decision & { order: number; lane: number; slot: number };

/** Lanes in the Rewind's order and words (You decided / Your rules decided / Safe default / Refused). */
const LANES: { who: Who; title: string; sub: string }[] = [
  { who: 'agent', title: 'Her signed rules', sub: 'her agent acted, her rules allowed it' },
  { who: 'owner', title: 'Maya', sub: 'in the approval window' },
  { who: 'deadline', title: 'A deadline', sub: 'released or voided, never paid' },
  { who: 'refused', title: 'Refused', sub: 'PayPal never asked' },
];
const money = (v: number) => `$${formatNumber(v, Number.isInteger(v) ? 0 : 2)}`;
const isWho = (v: unknown): v is Who => v === 'agent' || v === 'deadline' || v === 'owner' || v === 'refused';
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function decisionItems(ctx: MomentCtx): Item[] | undefined {
  const raw = ctx.record('decisions');
  if (!Array.isArray(raw)) return undefined;
  const ds: Decision[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || !isWho(r.decidedBy) || typeof r.amount !== 'number' || !Number.isFinite(r.amount)) continue;
    ds.push({ deal: String(r.deal ?? ''), step: String(r.step ?? ''), amount: r.amount, decidedBy: r.decidedBy, paid: r.paid === true, at: String(r.at ?? '') });
  }
  if (!ds.length) return undefined;
  // chronological (ISO strings of one record compare as text), ties keep record order
  const sorted = ds.map((d, i) => ({ d, i })).sort((a, b) => (a.d.at < b.d.at ? -1 : a.d.at > b.d.at ? 1 : a.i - b.i));
  const slots = [0, 0, 0, 0];
  return sorted.map(({ d }, order) => {
    const lane = LANES.findIndex((l) => l.who === d.decidedBy);
    return { ...d, order, lane, slot: slots[lane]++ };
  });
}

// ---- layout (screen px)
const LEFT = 160;
const LABEL_W = 360;
const X0 = LEFT + LABEL_W + 30; // first tile
const X1 = 1760;
const TOP = 262;
const LANE_H = 142;

function Tile({ it, x, y, w, h, p, lit, s }: { it: Item; x: number; y: number; w: number; h: number; p: number; lit: number; s: Style }) {
  const paid = it.paid;
  const roomy = w >= 120;
  return (
    <div
      style={{
        position: 'absolute', left: x, top: y - h / 2, width: w, height: h,
        borderRadius: Math.min(s.radius, w / 5), boxSizing: 'border-box', padding: roomy ? '10px 16px' : '6px 0',
        background: paid ? mix(s.bg, s.accent, 0.22 * lit) : alpha(s.bg, 0.9),
        border: `2px ${paid ? 'solid' : 'dashed'} ${paid ? s.accent : alpha(s.fg, 0.24)}`,
        boxShadow: paid ? `0 0 ${30 * lit}px ${alpha(s.accent, 0.45 * lit)}` : 'none',
        opacity: p, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: roomy ? 'stretch' : 'center', gap: roomy ? 4 : 3, overflow: 'hidden',
      }}
    >
      <div style={{ fontFamily: NUMERALS, fontVariantNumeric: 'tabular-nums lining-nums', fontWeight: 650, fontSize: roomy ? 28 : Math.min(18, (w - 8) / (money(it.amount).length * 0.6)), lineHeight: 1, color: paid ? s.fg : mix(s.fg, s.muted, 0.4), whiteSpace: 'nowrap' }}>
        {money(it.amount)}
      </div>
      {roomy || paid ? (
        <div style={{ ...capsStyle(s, roomy ? 12 : 10), letterSpacing: '0.14em', color: paid ? s.accent : s.muted, whiteSpace: 'nowrap' }}>{paid ? 'paid' : 'unpaid'}</div>
      ) : null}
    </div>
  );
}

export function WhoDecided({ ctx }: MomentProps<{ mode?: 'full' }>) {
  const f = useCurrentFrame();
  const s = useStyle();
  const items = decisionItems(ctx);
  if (!items) return null;
  const D = ctx.durFrames;

  const perLane = LANES.map((_, l) => items.filter((it) => it.lane === l).length);
  const most = Math.max(1, ...perLane);
  const gap = most > 10 ? 8 : 14;
  const tileW = Math.min(214, (X1 - X0 - gap * (most - 1)) / most);
  const tileH = tileW >= 120 ? 74 : 64;
  // schedule: the steps leave the source one after another, then the lanes total, then the recap
  const E0 = 26;
  const step = Math.min(9, Math.max(2.5, (D * 0.42) / items.length));
  const travel = 18;
  const landedAll = E0 + step * (items.length - 1) + travel;
  const totalsF = landedAll + 4;
  const recapF = landedAll + 18;

  const wipeIn = ctx.enters ? prog(f, 0, 14, s.ease) : 1;
  const out = ctx.exits ? prog(f, D - 16, 16, s.easeIn) : 0;
  const head = prog(f, 4, 18, s.ease);

  const paid = items.filter((it) => it.paid);
  const movedTotal = paid.reduce((a, it) => a + it.amount, 0);
  const nothing = items.length - paid.length;
  const paidWho = new Set(paid.map((it) => it.decidedBy));
  const recapLine =
    movedTotal === 0 ? 'moved. Nothing was paid.'
      : paidWho.size === 1 && paidWho.has('agent') ? 'moved, every dollar under rules she signed.'
        : [...paidWho].every((w) => w === 'agent' || w === 'owner') ? 'moved, every dollar by Maya or her signed rules.'
          : `moved; ${plural(paid.filter((it) => it.decidedBy !== 'agent' && it.decidedBy !== 'owner').length, 'paid step')} outside her rules.`;
  const recap = prog(f, recapF, 20, s.ease);
  const landed = Math.min(items.length, Math.max(0, Math.floor((f - E0 - travel) / step) + 1));

  return (
    <AbsoluteFill style={{ clipPath: `inset(${(1 - wipeIn) * 100}% 0 ${out * 100}% 0)` }}>
      <AbsoluteFill style={{ background: `radial-gradient(ellipse 85% 70% at 55% 50%, ${mix(s.bg, s.fg, 0.05)} 0%, ${s.bg} 78%)` }} />

      <div style={{ position: 'absolute', left: LEFT, right: 160, top: 92, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', opacity: head, transform: `translateY(${(1 - head) * 14}px)` }}>
        <div>
          <div style={{ ...capsStyle(s, 20), marginBottom: 12 }}>Who decided · the Rewind</div>
          <div style={{ fontFamily: s.display, fontWeight: 600, fontSize: 52, color: s.fg, letterSpacing: '-0.02em' }}>Every money step this week</div>
        </div>
        <div style={{ fontFamily: NUMERALS, fontVariantNumeric: 'tabular-nums lining-nums', fontSize: 28, color: s.muted }}>
          <span style={{ color: s.fg, fontWeight: 650 }}>{landed}</span> / {plural(items.length, 'step')}
        </div>
      </div>

      {/* lanes */}
      {LANES.map((l, i) => {
        const y = TOP + LANE_H * (i + 0.5);
        const p = prog(f, 8 + i * 4, 18, s.ease);
        const laneItems = items.filter((it) => it.lane === i);
        const lanePaid = laneItems.filter((it) => it.paid).reduce((a, it) => a + it.amount, 0);
        const hot = lanePaid > 0;
        const tp = prog(f, totalsF + i * 3, 16, s.ease);
        return (
          <div key={l.who} style={{ opacity: p }}>
            <div
              style={{
                position: 'absolute', left: LEFT - 24, top: y - LANE_H / 2 + 8, width: X1 - LEFT + 48, height: LANE_H - 16,
                borderRadius: s.radius * 1.2,
                background: hot ? alpha(s.accent, 0.06 * tp + 0.02) : alpha(s.fg, 0.025),
                border: `1px solid ${hot ? alpha(s.accent, 0.12 + 0.3 * tp) : alpha(s.fg, 0.07)}`,
                transform: `scaleX(${0.96 + 0.04 * p})`, transformOrigin: 'left',
              }}
            />
            <div style={{ position: 'absolute', left: LEFT, top: y - 42, width: LABEL_W }}>
              <div style={{ fontFamily: s.display, fontWeight: 650, fontSize: 34, color: hot ? mix(s.fg, s.accent, tp) : s.fg, letterSpacing: '-0.015em', lineHeight: 1.05 }}>{l.title}</div>
              <div style={{ fontFamily: s.body, fontSize: 18, color: s.muted, marginTop: 4 }}>{l.sub}</div>
              <div style={{ fontFamily: NUMERALS, fontVariantNumeric: 'tabular-nums lining-nums', fontSize: 19, color: hot ? s.accent : s.muted, marginTop: 6, opacity: tp }}>
                {plural(laneItems.length, 'step')} · {money(lanePaid)} paid
              </div>
            </div>
          </div>
        );
      })}

      {/* tiles flow from the top of the lanes into their lane and slot, oldest first */}
      {items.map((it) => {
        const t0 = E0 + it.order * step;
        const p = prog(f, t0, travel, s.ease);
        if (p <= 0) return null;
        const tx = X0 + it.slot * (tileW + gap);
        const ty = TOP + LANE_H * (it.lane + 0.5);
        const sx = X0 + (X1 - X0) * (it.order / Math.max(1, items.length - 1)) - tileW / 2;
        const sy = TOP - 40;
        const x = sx + (tx - sx) * p;
        const y = sy + (ty - sy) * p;
        const lit = it.paid ? prog(f, t0 + travel - 2, 12, s.ease) : 0;
        return <Tile key={`${it.deal}-${it.order}`} it={it} x={x} y={y} w={tileW} h={tileH} p={Math.min(1, p * 2.2)} lit={lit} s={s} />;
      })}

      {/* the recap, reduced from the record */}
      <div style={{ position: 'absolute', left: LEFT, right: 160, top: TOP + LANE_H * 4 + 30, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', opacity: recap, transform: `translateY(${(1 - recap) * 16}px)` }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 22 }}>
          <span style={{ fontFamily: NUMERALS, fontVariantNumeric: 'tabular-nums lining-nums', fontWeight: 700, fontSize: 76, color: s.accent, letterSpacing: '-0.02em' }}>{money(movedTotal)}</span>
          <span style={{ fontFamily: s.display, fontWeight: 600, fontSize: 40, color: s.fg }}>{recapLine}</span>
        </div>
        <div style={{ fontFamily: NUMERALS, fontVariantNumeric: 'tabular-nums lining-nums', fontSize: 28, color: s.muted, textAlign: 'right' }}>
          <span style={{ color: s.fg, fontWeight: 650 }}>{nothing}</span> other steps · nothing paid
        </div>
      </div>
    </AbsoluteFill>
  );
}
