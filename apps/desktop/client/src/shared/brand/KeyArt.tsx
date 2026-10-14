// Module key art: one calibration plate per module (stylised illustration). Corner brackets, edge
// rulers, a centre cross, a dot-screen and scan-line fill, all in the module's colour (--m-<key>).
// Line-work ported from the design target's deco.js `art()`; built as React elements, never as
// markup strings. The owner passes a plain label (role="img").
import { useId, type ReactNode } from 'react';
import type { Module } from '@bindings/Module';
import { TAU } from './geometry';
import './brand.css';

export const KEY_ART_MODULES: readonly Module[] = ['tables', 'spend', 'counter', 'book', 'shield', 'rescue'];

const fx = (n: number) => n.toFixed(1);

/** One filled shape: the plate's ground, then a dot-screen (1) or scan-line (2) fill, then the outline. */
function Sh({ d, h, ids }: { d: string; h: 1 | 2; ids: Ids }) {
  return (
    <>
      <path d={d} className="ground" stroke="none" />
      <path d={d} fill={`url(#${h === 2 ? ids.h2 : ids.h1})`} stroke="none" />
      <path d={d} />
    </>
  );
}
type Ids = { h1: string; h2: string; clip: string };

function Floor({ d, ids }: { d: string; ids: Ids }) {
  return <path d={d} fill={`url(#${ids.h2})`} stroke="none" />;
}

function tables(ids: Ids): ReactNode {
  const chair = (
    <>
      <Sh d="M46 58C52 53 64 53 70 58L68 112H50Z" h={1} ids={ids} />
      <Sh d="M50 112H92L96 120H54Z" h={2} ids={ids} />
      <path d="M46 58 50 150M54 120l2 30M92 120l2 30M68 120l2 25M52 74h16M52 88h16M52 100h15" />
    </>
  );
  return (
    <>
      <Floor d="M60 151a60 4 0 1 0 120 0a60 4 0 1 0-120 0" ids={ids} />
      {chair}
      <g transform="translate(240 0) scale(-1 1)">{chair}</g>
      <Sh d="M115 106 113 142H127L125 106Z" h={2} ids={ids} />
      <path d="M100 148 113 142M140 148 127 142M96 149h48" />
      <Sh d="M76 96a44 9 0 1 0 88 0a44 9 0 1 0-88 0" h={1} ids={ids} />
      <path d="M80 98l2 8h76l2-8" />
      <Sh d="M106 87h11l-1.5 8h-8z" h={2} ids={ids} />
      <path d="M117 89c3 0 3 4 0 4" />
      <Sh d="M129 95c-2-6 2-10 0-16h6c-2 6 2 10 0 16z" h={2} ids={ids} />
      <path d="M132 79c0-7 4-11 9-13M132 79c-1-7-5-10-10-11M141 66c2 0 3 1 3 3M122 68c-2 0-3 2-2 3" />
    </>
  );
}

function spend(ids: Ids): ReactNode {
  let weave = '';
  for (let x = 78; x <= 162; x += 12) weave += `M${x} 88L${(76 + (x - 64) * (88 / 112)).toFixed(1)} 146`;
  return (
    <>
      <Floor d="M50 151a70 4 0 1 0 140 0a70 4 0 1 0-140 0" ids={ids} />
      <path d="M84 80C84 26 156 26 156 80M92 80C92 38 148 38 148 80" />
      <Sh d="M98 80V56h28v24" h={2} ids={ids} />
      <path d="M98 64h28M112 56v24" />
      <Sh d="M134 80V62c0-4 3-6 3-10v-6h7v6c0 4 3 6 3 10v18" h={1} ids={ids} />
      <Sh d="M64 88H176L164 146H76Z" h={1} ids={ids} />
      <path d={`${weave}M70 106h100M73 124h94`} strokeWidth=".9" />
      <Sh d="M58 80h124v9H58z" h={2} ids={ids} />
      <Sh d="M184 146a12 3.5 0 1 0 24 0v-6a12 3.5 0 1 0-24 0z" h={2} ids={ids} />
      <Sh d="M186 134a12 3.5 0 1 0 24 0v-6a12 3.5 0 1 0-24 0z" h={1} ids={ids} />
      <Sh d="M184 122a12 3.5 0 1 0 24 0v-6a12 3.5 0 1 0-24 0z" h={2} ids={ids} />
      <path d="M184 116a12 3.5 0 1 0 24 0a12 3.5 0 1 0-24 0" />
    </>
  );
}

function counter(ids: Ids): ReactNode {
  return (
    <>
      <Floor d="M28 152a92 4 0 1 0 184 0a92 4 0 1 0-184 0" ids={ids} />
      <Sh d="M38 104h164v44H38z" h={1} ids={ids} />
      <path d="M48 112h44v28H48zM98 112h44v28H98zM148 112h44v28h-44z" />
      <Sh d="M30 96h180v8H30z" h={2} ids={ids} />
      <Sh d="M100 96h40v-4h-40z" h={2} ids={ids} />
      <Sh d="M104 92C104 68 136 68 136 92Z" h={2} ids={ids} />
      <path d="M110 84c2-7 6-10 10-11" strokeWidth=".9" />
      <Sh d="M117 70h6v-4h-6z" h={1} ids={ids} />
      <path d="M120 66v-4M146 70q7-6 5-15M153 76q11-9 9-24M94 70q-7-6-5-15M87 76q-11-9-9-24" />
      <Sh d="M164 96l8-16h20v16" h={1} ids={ids} />
      <path d="M60 96V60h22v36M64 66h14M64 72h14M64 78h10" strokeWidth="1.1" />
    </>
  );
}

function book(ids: Ids): ReactNode {
  let rules = '';
  for (let r = 0; r < 8; r++) {
    const yy = 76 + r * 8;
    rules += `M44 ${yy}Q78 ${yy - 6} 112 ${yy + 2}`;
  }
  const page = (
    <>
      <Sh d="M120 66C100 56 64 56 34 62V140C64 134 100 134 120 144Z" h={2} ids={ids} />
      <path d={`${rules}M98 66V138`} strokeWidth=".8" />
    </>
  );
  return (
    <>
      <Floor d="M40 156a80 4 0 1 0 160 0a80 4 0 1 0-160 0" ids={ids} />
      <Sh d="M28 68V148C64 142 100 142 120 152C140 142 176 142 212 148V68" h={1} ids={ids} />
      {page}
      <g transform="translate(240 0) scale(-1 1)">{page}</g>
      <path d="M120 66V150" />
      <Sh d="M126 146v22l5-5 5 5v-22" h={1} ids={ids} />
      <path d="M150 72l6-14 3 1-6 14z" />
    </>
  );
}

function shield(ids: Ids): ReactNode {
  let rays = '';
  for (let q = 0; q < 12; q++) {
    const an = (q / 12) * TAU;
    rays += `M${fx(120 + 20 * Math.cos(an))} ${fx(84 + 20 * Math.sin(an))}L${fx(120 + 27 * Math.cos(an))} ${fx(84 + 27 * Math.sin(an))}`;
  }
  return (
    <>
      <Sh d="M120 20 178 38C178 92 162 132 120 158 78 132 62 92 62 38Z" h={1} ids={ids} />
      <path d="M120 30 168 45C168 92 154 124 120 146 86 124 72 92 72 45Z" className="ground" />
      <path d={rays} strokeWidth=".9" />
      <path d="M114 52a6 6 0 1 1 12 0" />
      <Sh d="M106 64H134L128 56H112Z" h={2} ids={ids} />
      <Sh d="M108 64h24v40h-24z" h={2} ids={ids} />
      <path d="M108 64h24v40h-24zM116 64v40M124 64v40" />
      <path d="M120 74c-5 8-4 14 0 18 4-4 5-10 0-18z" fill="currentColor" fillOpacity=".85" />
      <Sh d="M104 104h32v6h-32z" h={1} ids={ids} />
    </>
  );
}

function rescue(ids: Ids): ReactNode {
  const cx = 120, cy = 90;
  const p = (rad: number, a: number) => `${fx(cx + rad * Math.cos(a))} ${fx(cy + rad * Math.sin(a))}`;
  const bands = [45, 135, 225, 315].map((deg) => {
    const a0 = ((deg - 16) * Math.PI) / 180, a1 = ((deg + 16) * Math.PI) / 180;
    return <Sh key={deg} d={`M${p(56, a0)}A56 56 0 0 1 ${p(56, a1)}L${p(26, a1)}A26 26 0 0 0 ${p(26, a0)}Z`} h={1} ids={ids} />;
  });
  let rope = '';
  for (let e = 0; e < 12; e++) {
    const b0 = (e / 12) * TAU + 0.26, b1 = ((e + 1) / 12) * TAU + 0.26, bm = (b0 + b1) / 2;
    rope += `M${fx(120 + 60 * Math.cos(b0))} ${fx(90 + 60 * Math.sin(b0))}Q${fx(120 + 70 * Math.cos(bm))} ${fx(90 + 70 * Math.sin(bm))} ${fx(120 + 60 * Math.cos(b1))} ${fx(90 + 60 * Math.sin(b1))}`;
  }
  const ring = 'M64 90a56 56 0 1 0 112 0a56 56 0 1 0-112 0ZM94 90a26 26 0 1 1 52 0a26 26 0 1 1-52 0Z';
  return (
    <>
      <path d={ring} className="ground" fillRule="evenodd" stroke="none" />
      <path d={ring} fill={`url(#${ids.h2})`} fillRule="evenodd" />
      {bands}
      <path d={rope} strokeWidth="1.1" />
      <path d="M22 162q12-8 24 0t24 0 24 0 24 0 24 0 24 0 24 0 24 0M34 170q12-8 24 0t24 0 24 0 24 0 24 0 24 0 24 0" strokeWidth=".9" />
    </>
  );
}

const SUBJECT: Record<Module, (ids: Ids) => ReactNode> = { tables, spend, counter, book, shield, rescue };

// The plate itself: graticule, centre cross, frame, corner brackets, edge rulers, a registration mark.
const GRID = (() => {
  let d = '';
  for (let gx = 30; gx < 222; gx += 12) d += `M${gx} 14V166`;
  for (let gy = 18; gy < 166; gy += 12) d += `M18 ${gy}H222`;
  return d;
})();
const RULE = (() => {
  let d = '';
  for (let k = 0; k <= 32; k++) d += `M${24 + k * 6} 170V${k % 5 === 0 ? 163 : 166.5}`;
  for (let k = 0; k <= 24; k++) d += `M14 ${18 + k * 6}H${k % 5 === 0 ? 21 : 17.5}`;
  return d;
})();
const BRACKETS = 'M14 22V10H26M214 10H226V22M226 158V170H214M26 170H14V158';

export type KeyArtProps = {
  module: Module;
  /** Plain words, e.g. "Stylised drawing: two chairs at a table". */
  label: string;
  className?: string;
};

export function KeyArt({ module, label, className }: KeyArtProps) {
  const base = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const ids: Ids = { h1: `ka1${base}`, h2: `ka2${base}`, clip: `kac${base}` };
  return (
    <svg className={`br-art${className ? ` ${className}` : ''}`} data-m={module} viewBox="0 0 240 180" role="img" aria-label={label} focusable="false">
      <defs>
        <pattern id={ids.h1} width="2.4" height="2.4" patternUnits="userSpaceOnUse"><circle cx="1.2" cy="1.2" r=".42" fill="currentColor" /></pattern>
        <pattern id={ids.h2} width="1.8" height="1.8" patternUnits="userSpaceOnUse"><path d="M0 .9H1.8" stroke="currentColor" strokeWidth=".4" /></pattern>
        <clipPath id={ids.clip}><rect x="18" y="14" width="204" height="152" /></clipPath>
      </defs>
      <g clipPath={`url(#${ids.clip})`}>
        <path d={GRID} stroke="currentColor" strokeWidth=".4" opacity=".2" />
        <path d="M120 14V166M18 90H222" stroke="currentColor" strokeWidth=".5" opacity=".34" strokeDasharray="2 3" />
      </g>
      <rect x="14" y="10" width="212" height="160" fill="none" stroke="currentColor" strokeWidth=".6" opacity=".45" />
      <path d={BRACKETS} fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d={RULE} fill="none" stroke="currentColor" strokeWidth=".6" opacity=".6" />
      <circle cx="206" cy="28" r="5" fill="none" stroke="currentColor" strokeWidth=".6" opacity=".6" />
      <path d="M199 28h14M206 21v14" stroke="currentColor" strokeWidth=".5" opacity=".6" />
      <g fill="none" stroke="currentColor" strokeWidth="1.15" strokeLinejoin="round" strokeLinecap="round">{SUBJECT[module](ids)}</g>
    </svg>
  );
}
