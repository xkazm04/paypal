// STAGE round 3: framer-motion transitions built from the design layer's named motion. Durations come
// from design/motion.ts (DUR, the same values as --dur-* in tokens.css). design/motion.ts has no
// easing export yet, so the curves below mirror --ease / --ease-out / --ease-in in tokens.css
// verbatim (fx.test.ts pins the copy against the CSS); the Director is asked to move them into
// design/motion.ts. Calm (OS reduced motion or the in-app calm class) = every duration 0.
import type { Transition } from 'framer-motion';
import { DUR, type DurName } from '../../../../design/motion';

/** tokens.css --ease (settle), --ease-out (arriving), --ease-in (leaving). */
export const EASE = {
  settle: [0.2, 0.8, 0.2, 1],
  out: [0.16, 1, 0.3, 1],
  in: [0.6, 0, 0.8, 0.2],
} as const satisfies Record<string, readonly [number, number, number, number]>;
export type EaseName = keyof typeof EASE;

/** A tween of a named duration and easing; instant when calm. */
export function tr(name: DurName, calm: boolean, ease: EaseName = 'settle'): Transition {
  return calm ? { duration: 0 } : { duration: DUR[name] / 1000, ease: [...EASE[ease]] };
}

/** The main column's travel (stage.css fs-today / fs-onstage used 24px) and the side's smaller one. */
export const TRAVEL = { main: 24, side: 12, tick: 6 } as const;

/** Direction of a move between two positions in an order: 1 forward, -1 back, 0 unknown or same. */
export function direction(from: number, to: number): -1 | 0 | 1 {
  if (from < 0 || to < 0 || from === to) return 0;
  return to > from ? 1 : -1;
}
