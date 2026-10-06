// Static, trusted SVG markup for the Dial: the engraved module medallions (ported from the
// winning prototype's art()), the machined bezel, rotor ticks, bead groove, hub plate and the
// gold index. No data ever reaches these strings, so dangerouslySetInnerHTML is safe here.
//
// Colour only from tokens (v2): every paint is a presentation attribute holding var(--…) or a
// color-mix() of tokens. The CSP (style-src 'self') blocks `style=""` in injected markup, but
// Chromium / WebView2 resolve var() and color-mix() in SVG presentation attributes. The dial's
// machined materials are the page-local `--d-*` variables defined in home.css (redefined for
// the light theme); markup that can render outside Home (headerArt, the medallions) falls back
// to global tokens when `--d-*` is not in scope.
import type { Module } from '@bindings/Module';
import { MODULE, MODULES } from '../../shared/modules';
import { C, R, STEP, pol, wedgePath } from './logic';

/** Gradient / pattern ids, prefixed so the always-mounted Dial never collides with page SVGs. */
export const DID = {
  shadow: 'dl-shadow', soft: 'dl-soft', noise: 'dl-noise', metal: 'dl-metal', rimlight: 'dl-rimlight', rimdark: 'dl-rimdark',
  ringbase: 'dl-ringbase', hubg: 'dl-hubg', medal: 'dl-medal', tealg: 'dl-tealg', okg: 'dl-okg', spec: 'dl-spec', goldg: 'dl-goldg',
  hatch: 'dl-hatch', wedge: (m: Module) => `dl-wg-${m}`,
} as const;
export const url = (id: string) => `url(#${id})`;

/** Paints (tokens only). The `--d-*` fallbacks keep the art right outside the Home scope. */
export const P = {
  gold: 'var(--d-gold, var(--gold))',
  goldDeep: 'var(--d-gold-deep, color-mix(in srgb, var(--gold) 55%, var(--bg)))',
  goldEdge: 'color-mix(in srgb, var(--gold) 45%, var(--d-hi, var(--text)))',
  hi: 'var(--d-hi, var(--text))',
  deep: 'var(--d-deep, var(--bg))',
  ink: 'var(--d-ink, var(--scrim))',
  engrave: 'var(--d-engrave, color-mix(in srgb, var(--bg) 72%, transparent))',
  tealEdge: 'color-mix(in srgb, var(--teal) 50%, var(--d-hi, var(--text)))',
} as const;

const colorOf = (key: Module): string => MODULE[key]?.cssVar ?? 'var(--text)';
const f1 = (n: number) => n.toFixed(1);
const stop = (o: number, c: string, a?: number) => `<stop offset="${o}" stop-color="${c}"${a === undefined ? '' : ` stop-opacity="${a}"`}/>`;

/** One pass of a module's engraving; `shadow` paints every stroke and fill in the engrave ink. */
function engraving(key: Module, shadow: boolean): string {
  const k = (col: string) => (shadow ? P.engrave : col);
  const c = k(colorOf(key));
  const G = k(P.gold);
  const s = (d: string, w = 3, col = c, extra = '') =>
    `<path d="${d}" fill="none" stroke="${k(col)}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
  switch (key) {
    case 'tables':
      return s('M8 88H92', 3) +
        s('M15 26Q12 46 18 62H38M18 62V86M38 62V86M11 26H21', 3.6, 'var(--teal)') + s('M17 40l9 0M17 50h10', 2, 'var(--teal)', 'opacity=".55"') +
        s('M85 26Q88 46 82 62H62M82 62V86M62 62V86M79 26H89', 3.6, 'var(--coral)') + s('M83 40l-9 0M83 50h-10', 2, 'var(--coral)', 'opacity=".55"') +
        s('M41 58H59M50 58V86M44 86H56', 3) +
        `<circle cx="50" cy="40" r="11" fill="${G}" stroke="${k(`color-mix(in srgb, var(--gold) 50%, ${P.hi})`)}" stroke-width="1.6"/>` +
        `<circle cx="50" cy="40" r="6.8" fill="none" stroke="${k(P.goldDeep)}" stroke-width="1.6"/>` +
        s('M50 35.5v9', 1.8, P.goldDeep);
    case 'spend':
      return s('M16 88V42A34 30 0 0 1 84 42V88', 3.8) + s('M10 88H90', 3) +
        s('M28 19V80M39 13.6V80M50 12V80M61 13.6V80M72 19V80', 2.6, c, 'opacity=".85"') +
        s('M26 80l2 6 2-6M37 80l2 6 2-6M48 80l2 6 2-6M59 80l2 6 2-6M70 80l2 6 2-6', 2, c) +
        s('M16 46H84M16 64H84', 2.6, c, 'opacity=".75"') +
        `<rect x="43" y="56" width="14" height="11" rx="2.2" fill="${G}"/>` + s('M46 56v-3.5a4 4 0 0 1 8 0V56', 2.2, P.gold) +
        `<circle cx="50" cy="61.5" r="1.6" fill="${k('var(--on-gold)')}"/>`;
    case 'counter':
      return s('M14 12H86L80 26H20Z', 2.6) + s('M20 26q4 5 8 0q4 5 8 0q4 5 8 0q4 5 8 0q4 5 8 0q4 5 8 0q4 5 8 0q4 5 8 0', 2, c, 'opacity=".8"') +
        s('M6 66H94', 4.4) + s('M12 66V91H88V66', 3) + s('M31 71v15M50 71v15M69 71v15', 2.2, c, 'opacity=".55"') +
        s('M35 62A15 15 0 0 1 65 62Z', 3) + s('M31 62.5H69', 3) + `<circle cx="50" cy="44.5" r="3.4" fill="${c}"/>` +
        s('M27 48l-6-3.5M73 48l6-3.5M50 36v-5', 2.2, P.gold);
    case 'book':
      return s('M50 28C38 21 25 20 11 21V77C25 76 38 77 50 84 62 77 75 76 89 77V21C75 20 62 21 50 28Z', 3.2) + s('M50 28V84', 2.4) +
        s('M19 34H41M19 42H41M19 50H36M19 58H41M19 66H33', 2, c, 'opacity=".7"') +
        s('M58 34H71M77 34H82M58 42H71M77 42H82M58 50H68M77 50H82M58 58H71M77 58H82', 2, c, 'opacity=".7"') +
        s('M57 66H82', 2.4, P.gold) +
        `<path d="M64 80h8v13l-4-3.5-4 3.5z" fill="${G}"/>`;
    case 'shield':
      return s('M38 20A12 10 0 0 1 62 20', 2.8) + `<circle cx="50" cy="10" r="3" fill="none" stroke="${c}" stroke-width="2.4"/>` +
        s('M33 28H67L62 20H38Z', 3) +
        `<rect x="37" y="28" width="26" height="46" rx="2" fill="${c}" fill-opacity=".12"/>` +
        s('M36 28V74M64 28V74', 3.4) + s('M50 29V73', 1.6, c, 'opacity=".4"') +
        `<path d="M50 38c8 9 9 16 0 27-9-11-8-18 0-27z" fill="${c}" fill-opacity=".92"/><path d="M50 51c3.4 4 3.6 7.6 0 12-3.6-4.4-3.4-8 0-12z" fill="${G}"/>` +
        s('M31 74H69L65 82H35Z', 3) + s('M27 88H73', 3.4);
    case 'rescue':
      return `<circle cx="50" cy="48" r="28" fill="none" stroke="${c}" stroke-width="14"/>` +
        `<circle cx="50" cy="48" r="28" fill="none" stroke="${k(P.hi)}" stroke-width="14" stroke-dasharray="22 22" stroke-dashoffset="11"/>` +
        `<circle cx="50" cy="48" r="35.5" fill="none" stroke="${c}" stroke-width="1.4" opacity=".6"/><circle cx="50" cy="48" r="20.5" fill="none" stroke="${c}" stroke-width="1.4" opacity=".6"/>` +
        s('M73 70C79 77 86 82 94 84', 2.6, P.gold) + s('M24 28c-3-3-3-6-1-9M76 28c3-3 3-6 1-9', 2, P.gold, 'opacity=".8"');
  }
}

/** Engraved illustration for a module, in a 100 x 100 box (shadow pass + face pass). */
export function medallionArt(key: Module): string {
  return `<g class="eg-sh" transform="translate(0 2.4)">${engraving(key, true)}</g><g>${engraving(key, false)}</g>`;
}

/** Module header art for Layer 1/2: the engraved medallion on a soft tinted glow. */
export function headerArt(key: Module): string {
  const c = colorOf(key);
  return `<defs><radialGradient id="ha-${key}" cx="50%" cy="55%" r="55%">${stop(0, c, 0.26)}${stop(1, c, 0)}</radialGradient></defs>
    <ellipse cx="100" cy="62" rx="98" ry="56" fill="url(#ha-${key})"/>
    <circle cx="100" cy="58" r="46" fill="var(--panel)" stroke="var(--line2)" stroke-width="2"/>
    <circle cx="100" cy="58" r="48.5" fill="none" stroke="${c}" stroke-opacity=".4" stroke-width="1.2"/>
    <g transform="translate(64 22) scale(.72)">${medallionArt(key)}</g>
    <path d="M8 114h184" stroke="${c}" stroke-opacity=".3"/>`;
}

// ---- the Dial's static layers -------------------------------------------------------------------

export function dialDefs(): string {
  let defs = `<defs>
    <filter id="${DID.shadow}" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="24" stdDeviation="24" flood-color="var(--d-shadow)"/></filter>
    <filter id="${DID.soft}" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="6" stdDeviation="7" flood-color="var(--d-shadow)"/></filter>
    <filter id="${DID.noise}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="2.2 .02" numOctaves="2" seed="4"/><feColorMatrix values="0 0 0 0 .6  0 0 0 0 .62  0 0 0 0 .66  0 0 0 .22 0"/><feComposite in2="SourceGraphic" operator="in"/></filter>
    <linearGradient id="${DID.metal}" x1="0" y1="0" x2="1" y2="1">${stop(0, 'var(--d-m1)')}${stop(0.22, 'var(--d-m2)')}${stop(0.48, 'var(--d-m3)')}${stop(0.74, 'var(--d-m4)')}${stop(1, 'var(--d-m5)')}</linearGradient>
    <linearGradient id="${DID.rimlight}" x1="0" y1="0" x2="0" y2="1">${stop(0, P.hi, 0.38)}${stop(0.5, P.hi, 0.02)}${stop(1, P.deep, 0.5)}</linearGradient>
    <linearGradient id="${DID.rimdark}" x1="0" y1="0" x2="0" y2="1">${stop(0, P.deep, 0.5)}${stop(1, P.hi, 0.16)}</linearGradient>
    <radialGradient id="${DID.ringbase}" cx="500" cy="500" r="460" gradientUnits="userSpaceOnUse">${stop(0.74, 'var(--d-ring1)')}${stop(0.88, 'var(--d-ring2)')}${stop(1, 'var(--d-ring3)')}</radialGradient>
    <radialGradient id="${DID.hubg}" cx="44%" cy="36%" r="70%">${stop(0, 'var(--d-hub1)')}${stop(0.6, 'var(--d-hub2)')}${stop(1, 'var(--d-hub3)')}</radialGradient>
    <radialGradient id="${DID.medal}" cx="45%" cy="38%" r="65%">${stop(0, 'var(--d-medal1)')}${stop(1, 'var(--d-medal2)')}</radialGradient>
    <radialGradient id="${DID.tealg}" cx="38%" cy="32%" r="70%">${stop(0, `color-mix(in srgb, var(--teal) 40%, ${P.hi})`)}${stop(0.45, 'var(--teal)')}${stop(1, `color-mix(in srgb, var(--teal) 55%, ${P.deep})`)}</radialGradient>
    <radialGradient id="${DID.okg}" cx="38%" cy="32%" r="70%">${stop(0, `color-mix(in srgb, var(--ok) 40%, ${P.hi})`)}${stop(0.5, 'var(--ok)')}${stop(1, `color-mix(in srgb, var(--ok) 55%, ${P.deep})`)}</radialGradient>
    <radialGradient id="${DID.spec}" cx="30%" cy="18%" r="80%">${stop(0, P.hi, 0.1)}${stop(0.45, P.hi, 0.02)}${stop(1, P.deep, 0.18)}</radialGradient>
    <linearGradient id="${DID.goldg}" x1="0" y1="0" x2="0" y2="1">${stop(0, `color-mix(in srgb, var(--gold) 45%, ${P.hi})`)}${stop(0.6, P.gold)}${stop(1, P.goldDeep)}</linearGradient>
    <pattern id="${DID.hatch}" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="color-mix(in srgb, var(--gold) 22%, var(--d-ring1))"/><line x1="0" y1="0" x2="0" y2="5" stroke="${P.gold}" stroke-width="2.4"/></pattern>`;
  for (const m of MODULES) {
    defs += `<radialGradient id="${DID.wedge(m.key)}" cx="500" cy="500" r="${R.secO}" gradientUnits="userSpaceOnUse">${stop(0.75, m.cssVar, 0.05)}${stop(0.9, m.cssVar, 0.16)}${stop(1, m.cssVar, 0.34)}</radialGradient>`;
  }
  return defs + `</defs>`;
}

export function dialBezel(): string {
  let knurl = '';
  for (let k = 0; k < 180; k++) {
    const a = k * 2;
    const [x0, y0] = pol(R.bez + 5, a);
    const [x1, y1] = pol(R.bez + 9, a);
    knurl += `M${f1(x0)} ${f1(y0)}L${f1(x1)} ${f1(y1)}`;
  }
  return `<circle cx="${C}" cy="${C}" r="496" fill="var(--d-groove-edge)" filter="${url(DID.shadow)}"/>
    <circle cx="${C}" cy="${C}" r="${R.bez}" fill="none" stroke="${url(DID.metal)}" stroke-width="${R.bezW}"/>
    <circle cx="${C}" cy="${C}" r="${R.bez}" fill="none" stroke="${P.deep}" stroke-width="${R.bezW}" filter="${url(DID.noise)}" opacity=".9"/>
    <path d="${knurl}" stroke="${P.ink}" stroke-width="1.6"/>
    <circle cx="${C}" cy="${C}" r="${R.bez + R.bezW / 2}" fill="none" stroke="${url(DID.rimlight)}" stroke-width="1.6"/>
    <circle cx="${C}" cy="${C}" r="${R.bez - R.bezW / 2}" fill="none" stroke="${url(DID.rimdark)}" stroke-width="1.6"/>`;
}

/** Rotor base: the rim band with its 120 ticks and the sector bed. */
export function rotorBase(): string {
  let ticks = '';
  for (let k = 0; k < 120; k++) {
    const a = k * 3;
    const major = k % 20 === 0;
    const mid = k % 5 === 0;
    const [x0, y0] = pol(R.rimO - 2, a);
    const [x1, y1] = pol(major ? R.rimI - 2 : mid ? R.rimI + 3 : R.rimI + 7, a);
    ticks += `<line x1="${f1(x0)}" y1="${f1(y0)}" x2="${f1(x1)}" y2="${f1(y1)}" stroke="${major ? 'var(--text)' : 'var(--muted)'}" stroke-opacity="${major ? 0.85 : mid ? 0.55 : 0.3}" stroke-width="${major ? 2.4 : 1.4}"/>`;
  }
  return `<circle cx="${C}" cy="${C}" r="${(R.rimI + R.rimO) / 2}" fill="none" stroke="var(--d-rim)" stroke-width="${R.rimO - R.rimI}"/>
    ${ticks}
    <circle cx="${C}" cy="${C}" r="${(R.secI + R.secO) / 2}" fill="none" stroke="var(--d-groove-edge)" stroke-width="${R.secO - R.secI + 4}"/>`;
}

export function rotorDividers(): string {
  let out = '';
  for (let i = 0; i < MODULES.length; i++) {
    const a = i * STEP + STEP / 2;
    const [x0, y0] = pol(R.secI, a);
    const [x1, y1] = pol(R.secO, a);
    out += `<line x1="${f1(x0)}" y1="${f1(y0)}" x2="${f1(x1)}" y2="${f1(y1)}" stroke="var(--d-groove-edge)" stroke-width="3.5"/><line x1="${f1(x0 + 0.9)}" y1="${f1(y0 + 0.9)}" x2="${f1(x1 + 0.9)}" y2="${f1(y1 + 0.9)}" stroke="${P.hi}" stroke-opacity=".08" stroke-width="1"/>`;
  }
  return out + `<circle cx="${C}" cy="${C}" r="${R.secO + 1}" fill="none" stroke="${P.ink}" stroke-width="2"/>`;
}

export function groove(): string {
  return `<circle cx="${C}" cy="${C}" r="${R.track}" fill="none" stroke="var(--d-groove-edge)" stroke-width="${R.trackW + 6}"/>
    <circle cx="${C}" cy="${C}" r="${R.track}" fill="none" stroke="var(--d-groove)" stroke-width="${R.trackW}"/>
    <circle cx="${C}" cy="${C}" r="${R.track + R.trackW / 2}" fill="none" stroke="${url(DID.rimlight)}" stroke-width="1.2" transform="rotate(180 500 500)"/>
    <circle cx="${C}" cy="${C}" r="${R.track - R.trackW / 2}" fill="none" stroke="${url(DID.rimlight)}" stroke-width="1.2"/>`;
}

export function hubPlate(): string {
  let grooves = '';
  for (let r = 22; r < R.hub - 4; r += 7) grooves += `<circle cx="${C}" cy="${C}" r="${r}" fill="none" stroke="var(--text)" stroke-opacity="${r % 14 ? 0.02 : 0.035}" stroke-width="1"/>`;
  return `<circle cx="${C}" cy="${C}" r="${R.hub}" fill="${url(DID.hubg)}" filter="${url(DID.soft)}"/>
    ${grooves}
    <circle cx="${C}" cy="${C}" r="${R.hub}" fill="none" stroke="${url(DID.rimlight)}" stroke-width="2.2"/>
    <circle cx="${C}" cy="${C}" r="${R.hub - 9}" fill="none" stroke="${url(DID.rimdark)}" stroke-width="1.2"/>`;
}

export const SPEC = `<circle cx="${C}" cy="${C}" r="496" fill="${url(DID.spec)}" pointer-events="none"/>`;
export const INDEX = `<path d="M500 32L484 4H516Z" fill="${url(DID.goldg)}" stroke="${P.goldEdge}" stroke-width="1"/><path d="M500 32V${C - R.secO - 4}" stroke="${P.gold}" stroke-width="2.4"/>`;
export const WINDOW_PATH = wedgePath(-STEP / 2 + 1.5, STEP / 2 - 1.5, R.secI - 2, R.secO + 2);
export const RING_HIT = `M500 4a496 496 0 1 0 .01 0ZM500 ${C - R.hub - 4}a${R.hub + 4} ${R.hub + 4} 0 1 1 -.01 0Z`;

/** Small lock glyph used on buttons and the lock indicator (16 x 16). */
export const LOCK_CLOSED = `<rect x="3" y="7" width="10" height="7.5" rx="1.6" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/>`;
export const LOCK_OPEN = `<rect x="3" y="7" width="10" height="7.5" rx="1.6" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 5.8-1.1" fill="none" stroke="currentColor" stroke-width="1.6"/>`;
