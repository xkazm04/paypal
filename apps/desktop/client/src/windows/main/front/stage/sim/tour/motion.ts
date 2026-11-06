// TOUR motion: framer-motion transitions built only from the design layer's named values.
// Durations come from design/motion.ts (DUR, the same numbers as --dur-*). design/motion.ts has no
// easing export yet, so the easing is read from the CSS token itself (--ease / --ease-out on :root),
// never typed here; until tokens.css is on the page, framer's own named curve stands in.
// Calm (OS reduced motion or the in-app calm class) makes every transition instant.
import type { Transition } from 'framer-motion';
import { DUR, type DurName } from '../../../../../../design/motion';

type Curve = [number, number, number, number];

/** cubic-bezier(a, b, c, d) from a CSS custom property on :root, or null. */
export function tokenCurve(name: '--ease' | '--ease-out' | '--ease-in', root: Element | null = typeof document === 'undefined' ? null : document.documentElement): Curve | null {
  if (!root || typeof getComputedStyle !== 'function') return null;
  const raw = getComputedStyle(root).getPropertyValue(name).trim();
  const m = /^cubic-bezier\(([^)]+)\)$/.exec(raw);
  if (!m) return null;
  const n = m[1]!.split(',').map((x) => Number.parseFloat(x));
  return n.length === 4 && n.every((x) => Number.isFinite(x)) ? (n as Curve) : null;
}

/** A transition of a named duration on a named token curve; instant when calm. */
export function tx(dur: DurName, calm: boolean, curve: '--ease' | '--ease-out' | '--ease-in' = '--ease'): Transition {
  if (calm) return { duration: 0 };
  return { duration: DUR[dur] / 1000, ease: tokenCurve(curve) ?? 'easeOut' };
}
