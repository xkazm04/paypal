// The GUIDE simulation's own little state, shared by GuideSim and the cards it hands to the
// transcript (host.say). The cards render inside Stage's tree, not under GuideSim, so they read the
// guide's phase from here instead of from props captured when they were said. Nothing of the wallet
// lives here: progress always comes from useStart (the world).
import { useSyncExternalStore } from 'react';
import type { StartStepKey } from '../../../../../../lib/words';
import type { SimRegion } from '../host';

export type GuidePhase = 'intro' | 'step' | 'paused' | 'done' | 'over';
export type GuideState = {
  phase: GuidePhase;
  /** The serial of the live step card; an older card of the same step folds to one line. */
  live: number;
};

let state: GuideState = { phase: 'intro', live: 0 };
const subs = new Set<() => void>();

export const guideState = (): GuideState => state;
export function setGuide(patch: Partial<GuideState>): void {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
}
export function resetGuide(): void {
  state = { phase: 'intro', live: 0 };
  subs.forEach((f) => f());
}
export function useGuide(): GuideState {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, guideState, guideState);
}

/** What the cards may ask the guide to do (GuideSim implements it; stable for the session). */
export type GuideCtl = {
  start(): void;
  skip(): void;
  resume(): void;
  /** Ask the real assistant (host.ask); the guide picks the step up again after the answer. */
  ask(question: string): void;
  home(): void;
  leave(): void;
  /** Point at a region briefly, with a caption. */
  point(region: SimRegion, caption: string): void;
};

export type StepCardProps = { step: StartStepKey; serial: number; ctl: GuideCtl };
