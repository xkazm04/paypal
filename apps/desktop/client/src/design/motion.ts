// Named motion for the Calibre design layer. CSS reads the same values from tokens.css
// (--hold-ms, --dur-*); design/tokens.test.ts keeps the two in step. Use these instead of magic
// delays: the prototype's 80/120/380/460/900 ms timeouts each map to one name here.
import { useEffect, useState } from 'react';

/** Hold the seal this long to confirm (approval window only). */
export const HOLD_MS = 1200;
/** A released, unfinished hold drains back to empty over this long (visual only). */
export const HOLD_DRAIN_MS = 280;
/** Durations, in milliseconds, matching --dur-* in tokens.css. */
export const DUR = { instant: 80, fast: 120, med: 200, slow: 380, sheet: 460 } as const;
export type DurName = keyof typeof DUR;

/** The in-app calm class. Set on <html>; base.css stops decorative motion under it. */
export const CALM_CLASS = 'calm';

const listeners = new Set<(calm: boolean) => void>();

function reducedMotionQuery(): MediaQueryList | null {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  } catch {
    return null;
  }
}

/** True when motion should be calm: the OS asks for reduced motion, or the in-app calm class is on. */
export function isCalm(): boolean {
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    if (root.classList.contains(CALM_CLASS) || document.body?.classList.contains(CALM_CLASS)) return true;
  }
  return reducedMotionQuery()?.matches ?? false;
}

/** Turns the in-app calm mode on or off (display only) and notifies `useCalm` subscribers. */
export function setCalm(on: boolean): void {
  if (typeof document !== 'undefined') document.documentElement.classList.toggle(CALM_CLASS, on);
  const now = isCalm();
  for (const l of listeners) l(now);
}

/** Whether motion is calm right now; re-renders when the OS setting or the in-app mode changes. */
export function useCalm(): boolean {
  const [calm, set] = useState(isCalm);
  useEffect(() => {
    const sync = () => set(isCalm());
    listeners.add(sync);
    const q = reducedMotionQuery();
    q?.addEventListener?.('change', sync);
    return () => {
      listeners.delete(sync);
      q?.removeEventListener?.('change', sync);
    };
  }, []);
  return calm;
}

/** A duration, or 0 when motion is calm. */
export function motionMs(name: DurName, calm: boolean = isCalm()): number {
  return calm ? 0 : DUR[name];
}
