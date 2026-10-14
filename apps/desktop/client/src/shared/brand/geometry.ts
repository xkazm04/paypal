// Pure geometry for the Calibre decoration (rebuild WP1a): the calibrated scale as SVG path data.
// No DOM, no colours: components in this folder turn these strings into <path d>. Ported from the
// design target's deco.js (prototype/console-calibre), which built the same paths as innerHTML.

export const TAU = Math.PI * 2;

/** A number rounded to 2 decimals, as SVG text. */
export const f1 = (n: number): string => (Math.round(n * 100) / 100).toString();

/** "x y" of the point at radius r and angle a (radians). */
export const pol = (r: number, a: number): string => `${f1(r * Math.cos(a))} ${f1(r * Math.sin(a))}`;

/** n radial ticks between r0 and r1 as one path; `off` turns them by a fraction of a turn. 12 o'clock first. */
export function ticks(r0: number, r1: number, n: number, off = 0): string {
  let d = '';
  for (let k = 0; k < n; k++) {
    const a = (k / n + off) * TAU - Math.PI / 2;
    d += `M${pol(r0, a)}L${pol(r1, a)}`;
  }
  return d;
}

/** A ring of radius r broken into n dashes, each `fill` (0..1) of its slot. */
export function dashes(r: number, n: number, fill = 0.5): string {
  let d = '';
  const w = (TAU / n) * fill;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU;
    d += `M${pol(r, a)}A${r} ${r} 0 0 1 ${pol(r, a + w)}`;
  }
  return d;
}

/** The brand mark: a reticle inside a bezel of 24 ticks (viewBox -12 -12 24 24). */
export const MARK_D = `M0 -7.4V-3M0 7.4V3M-7.4 0H-3M7.4 0H3${ticks(8.6, 10.5, 24)}M-.9 0H.9M0 -.9V.9`;

/** The rosette: four tick rings (inner first) in viewBox -24 -24 48 48. */
export const ROSETTE_RINGS: readonly { r: number; d: string }[] = [0, 1, 2, 3].map((i) => ({
  r: 8 + i * 4,
  d: ticks(6.6 + i * 4, 9.2 + i * 4, 16 + i * 8),
}));

/** How full ring i of `count` is at overall progress p (0..1): the rings fill one after another. */
export function ringFill(p: number, i: number, count: number): number {
  return Math.min(1, Math.max(0, p * count - i));
}

/** The 12 degree numerals of the seal's bezel: "000" … "330", with their position on radius r. */
export function degreeMarks(r: number): readonly { label: string; x: string; y: string; angle: number }[] {
  return Array.from({ length: 12 }, (_, k) => {
    const angle = k * 30;
    const rad = (angle / 360) * TAU - Math.PI / 2;
    return { label: String(angle).padStart(3, '0'), x: f1(r * Math.cos(rad)), y: f1(r * Math.sin(rad)), angle };
  });
}

/** The signal sweep's soft trailing wedge: 8 slices fading behind the leading edge (radius 36). */
export const SWEEP_WEDGES: readonly { d: string; opacity: string }[] = Array.from({ length: 8 }, (_, k) => {
  const a0 = -Math.PI / 2 - (k + 1) * 0.07;
  const a1 = -Math.PI / 2 - k * 0.07;
  return { d: `M0 0L${pol(36, a0)}A36 36 0 0 1 ${pol(36, a1)}Z`, opacity: f1(0.15 * Math.pow(0.72, k)) };
});

/** The seal's line-work in three bands (outer bezel, vernier graticule, reticle). viewBox -50 -50 100 100. */
export const SEAL_BANDS = {
  bezel: {
    paths: [ticks(46.9, 48.3, 180), ticks(45.3, 48.3, 36), ticks(44.4, 48.3, 4)],
    circles: [48.9, 44.4, 41.4, 37.6],
  },
  vernier: {
    paths: [ticks(34.4, 36.1, 120), ticks(31.4, 33.0, 108), dashes(29.2, 72, 0.45), ticks(21.6, 34.4, 12, 1 / 24)],
    circles: [33.7, 25.2, 21.6],
  },
  reticle: {
    paths: ['M-19 0H-6M6 0H19M0 -19V-6M0 6V19', ticks(11.8, 13.4, 48), ticks(10.6, 13.4, 8), 'M-1.2 0H1.2M0 -1.2V1.2'],
    circles: [16.8, 12.6, 3.2],
  },
} as const;

/** The microprint ring's path (radius 39.5, starting at 12 o'clock, clockwise). */
export const MICRO_RING_D = 'M0 -39.5 A39.5 39.5 0 1 1 -0.01 -39.5';
