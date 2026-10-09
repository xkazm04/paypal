// The engraved puck: a miniature of The Dial's machined vault. Six module ticks on the rim,
// one bead per open item beside its module's tick, a gold ring when anything needs Maya (coral
// when only holds wait), the count in the centre and the mode engraved below it.
// Geometry is numbers only; every colour is a token, set by class in tumbler.css (gradient stops
// included) or, for the module ticks, as `var(--m-<module>)` through CSSOM. The Tumbler follows the
// stored theme like The Table, so the puck's tokens resolve to the dark or the light set.
import type { AttentionItem } from '@bindings/AttentionItem';
import type { Mode } from '@bindings/Mode';
import { MODULES } from '../../shared/modules';
import { MODE_SHORT, type PuckLook } from './logic';

const C = 44;
const pol = (r: number, deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [C + r * Math.sin(a), C - r * Math.cos(a)];
};
const f = (n: number) => n.toFixed(2);

// static geometry, computed once
const KNURL = Array.from({ length: 90 }, (_, k) => {
  const [x0, y0] = pol(40.6, k * 4);
  const [x1, y1] = pol(42.9, k * 4);
  return `M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}`;
}).join('');
const GROOVES = Array.from({ length: 7 }, (_, i) => 6 + i * 3.5);
const TICKS = MODULES.map((m, i) => {
  const [x0, y0] = pol(37.4, i * 60);
  const [x1, y1] = pol(40.4, i * 60);
  return { key: m.key, color: m.cssVar, x0, y0, x1, y1 };
});
const MODULE_INDEX = new Map(MODULES.map((m, i) => [m.key, i]));
const BEAD_OFFSETS = [0, 15, -15, 30, -30, 45];

export type PuckProps = {
  look: PuckLook;
  items: readonly AttentionItem[];
  newIds: ReadonlySet<string>;
  inMotion: number;
  mode: Mode | null;
  locked: boolean;
  handoff: boolean;
};

export function PuckArt({ look, items, newIds, inMotion, mode, locked, handoff }: PuckProps) {
  const per = new Map<string, number>();
  const beads = items.flatMap((it) => {
    const k = per.get(it.module) ?? 0;
    per.set(it.module, k + 1);
    const off = BEAD_OFFSETS[k];
    if (off === undefined) return [];
    const [x, y] = pol(34.4, (MODULE_INDEX.get(it.module) ?? 0) * 60 + off);
    const cls = `bead ${it.kind === 'hold' ? 'hold' : 'gate'}${newIds.has(it.deal_id) ? ' new' : ''}`;
    return [<circle key={it.deal_id} className={cls} cx={f(x)} cy={f(y)} r="3.4" strokeOpacity={0.5} strokeWidth={0.6} />];
  });
  return (
    <svg viewBox="0 0 88 88" aria-hidden="true" className="puck-art">
      <defs>
        <linearGradient id="tb-pm" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" className="pm0" /><stop offset=".25" className="pm1" /><stop offset=".5" className="pm2" />
          <stop offset=".76" className="pm3" /><stop offset="1" className="pm4" />
        </linearGradient>
        <linearGradient id="tb-prl" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="prl0" /><stop offset=".5" className="prl1" /><stop offset="1" className="prl2" />
        </linearGradient>
        <radialGradient id="tb-ph" cx="42%" cy="34%" r="72%">
          <stop offset="0" className="ph0" /><stop offset=".6" className="ph1" /><stop offset="1" className="ph2" />
        </radialGradient>
        <filter id="tb-blur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.4" /></filter>
      </defs>
      <circle className="p-base" cx={C} cy={C} r="43.6" />
      <circle className="glow" cx={C} cy={C} r="42.6" fill="none" strokeWidth="5" filter="url(#tb-blur)" />
      <circle cx={C} cy={C} r="40.9" fill="none" stroke="url(#tb-pm)" strokeWidth="5" />
      <path className="p-knurl" d={KNURL} strokeOpacity=".5" strokeWidth=".9" />
      <circle cx={C} cy={C} r="43.4" fill="none" stroke="url(#tb-prl)" strokeWidth=".8" />
      <circle className="ring" cx={C} cy={C} r="43.1" fill="none" strokeWidth="1.9" />
      <circle className="p-well" cx={C} cy={C} r="34.4" fill="none" strokeWidth="8.6" />
      <circle className="p-track" cx={C} cy={C} r="34.4" fill="none" strokeWidth="6.6" />
      {TICKS.map((t) => (
        <line key={t.key} x1={f(t.x0)} y1={f(t.y0)} x2={f(t.x1)} y2={f(t.y1)} style={{ stroke: t.color }} strokeWidth="2.2" strokeLinecap="round" />
      ))}
      {beads}
      <circle cx={C} cy={C} r="30" fill="url(#tb-ph)" />
      {GROOVES.map((r) => (
        <circle key={r} className="p-groove" cx={C} cy={C} r={r} fill="none" strokeOpacity={r % 7 < 3.5 ? 0.05 : 0.025} strokeWidth=".7" />
      ))}
      <circle cx={C} cy={C} r="30" fill="none" stroke="url(#tb-prl)" strokeWidth="1.1" />
      {handoff ? (
        <g className="sweep">
          <path d="M44 44L44 16" strokeOpacity=".5" strokeWidth="1.2" strokeLinecap="round" />
          <circle cx="44" cy="16" r="1.8" />
        </g>
      ) : null}
      {locked ? (
        <g className="p-lock" transform="translate(39.5 18.5) scale(.56)">
          <rect x="3" y="7" width="10" height="7.5" rx="1.6" />
          <path d="M5.2 7V5.2a2.8 2.8 0 0 1 5.6 0V7" fill="none" strokeWidth="1.8" />
        </g>
      ) : null}
      {look.needs ? (
        <text className="cnt" x={C} y="50" textAnchor="middle">{look.needs}</text>
      ) : (
        <text className="cnt calm" x={C} y="49" textAnchor="middle">{inMotion}</text>
      )}
      {mode ? <text className="mode" x={C} y="63" textAnchor="middle" textLength="44" lengthAdjust="spacingAndGlyphs">{MODE_SHORT[mode]}</text> : null}
    </svg>
  );
}
