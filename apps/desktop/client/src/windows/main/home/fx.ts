// framer-motion transitions built from the design layer's named motion (design/motion.ts: DUR and
// EASE, the same values as --dur-* and --ease* in tokens.css). Calm (OS reduced motion or the in-app
// calm class) = every duration 0.
import type { Transition } from 'framer-motion';
import { DUR, EASE, type DurName, type EaseName } from '../../../design/motion';

/** A tween of a named duration and easing; instant when calm. */
export function tr(name: DurName, calm: boolean, ease: EaseName = 'settle'): Transition {
  return calm ? { duration: 0 } : { duration: DUR[name] / 1000, ease: [...EASE[ease]] };
}

/** The main column's travel (home.css fs-today / fs-onstage use 24px) and the side's smaller one. */
export const TRAVEL = { main: 24, side: 12, tick: 6 } as const;

/** Direction of a move between two positions in an order: 1 forward, -1 back, 0 unknown or same. */
export function direction(from: number, to: number): -1 | 0 | 1 {
  if (from < 0 || to < 0 || from === to) return 0;
  return to > from ? 1 : -1;
}
