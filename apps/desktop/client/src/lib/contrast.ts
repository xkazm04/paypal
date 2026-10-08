// WCAG 2.2 contrast, pure: relative luminance, the contrast ratio and alpha compositing for the
// colours in src/design/tokens.css. Used by the token tests (contrast.test.ts) so a palette change
// that makes text unreadable in either theme fails the build, not a screenshot review.

export type Rgb = readonly [number, number, number];
export type Rgba = readonly [number, number, number, number];

/** "#rgb", "#rrggbb" or "#rrggbbaa" -> [r, g, b, a] (0-255, alpha 0-1). Null when not a hex colour. */
export function parseHex(hex: string): Rgba | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex.trim());
  if (!m?.[1]) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
}

/** Paint `fg` (with alpha) over an opaque `bg`. */
export function over(fg: Rgba, bg: Rgb): Rgb {
  const a = fg[3];
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a)];
}

/** `color-mix(in srgb, a p%, b)` for opaque colours (p in 0..100). */
export function mix(a: Rgb, p: number, b: Rgb): Rgb {
  return over([a[0], a[1], a[2], p / 100], b);
}

/** WCAG relative luminance of an sRGB colour (0..1). */
export function luminance([r, g, b]: Rgb): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG contrast ratio between two opaque colours (1..21). */
export function contrast(a: Rgb, b: Rgb): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** The AA minimum for text: 3 for large text (24px, or 18.66px bold), 4.5 otherwise. */
export function aaMinimum(px: number, bold = false): number {
  return px >= 24 || (bold && px >= 18.66) ? 3 : 4.5;
}

/**
 * The `--name: #hex;` declarations of one CSS block (later ones win). Only hex values are kept:
 * `var()` and `color-mix()` references are resolved by the caller where it matters.
 */
export function hexTokens(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-f]{3,8})\b/gi)) {
    if (m[1] && m[2]) out[m[1]] = m[2];
  }
  return out;
}
