// Static, trusted SVG markup: the engraved module medallions (ported from the winning prototype's
// art()) for the module headers, and the lock glyph. The Dial home's bezel, rotor, groove and hub
// went with it (console rebuild WP2). No data ever reaches these strings, so
// dangerouslySetInnerHTML is safe here.
//
// Colour only from tokens (v2): every paint is a presentation attribute holding var(--…) or a
// color-mix() of tokens. The CSP (style-src 'self') blocks `style=""` in injected markup, but
// Chromium / WebView2 resolve var() and color-mix() in SVG presentation attributes. The dial's
// machined materials are the page-local `--d-*` variables defined in home.css (redefined for
// the light theme); markup that can render outside Home (headerArt, the medallions) falls back
// to global tokens when `--d-*` is not in scope.
import type { Module } from '@bindings/Module';
import { MODULE } from '../../shared/modules';

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

export const LOCK_CLOSED = `<rect x="3" y="7" width="10" height="7.5" rx="1.6" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/>`;
export const LOCK_OPEN = `<rect x="3" y="7" width="10" height="7.5" rx="1.6" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 5.8-1.1" fill="none" stroke="currentColor" stroke-width="1.6"/>`;
