// The setup guide's own small state, shared by Guide (the controller, mounted beside
// the home) and the turns it hands to the transcript (host.say). Those cards live in Stage's tree, not
// under Guide, so they read the flow from here instead of from props captured when they were said.
// Nothing of the wallet lives here: whether a step is done always comes from useStart (the world).
//   status  new: never ran · active: a step's turn is open · skipped: paused by "Skip for now" ·
//           finished: "You're set" was said
//   live    the serial of the ONE open turn; an older turn folds to a line (never two open components)
//   rules   the proposal she may change by saying so (rules.ts)
//   spot    the one spotlight mark on screen, or null
// status and rules are kept per world (localStorage, may be blocked: then the session keeps them);
// the step itself is never stored: reload asks useStart which step is next.
import { useSyncExternalStore } from 'react';
import { START_ORDER, type GettingStarted } from '../../../../lib/firstRun';
import type { StartStepKey } from '../../../../lib/words';
import type { HomeRegion } from './host';
import { RULES_START, type RulesAsk } from './rules';

export type FlowStatus = 'new' | 'active' | 'skipped' | 'finished';
/** Where a spotlight points: a region Stage marks, or one module's segment in the side switcher. */
export type SpotTarget = { region: HomeRegion } | { segment: 'tables' | 'spend' | 'book' };
export type Spot = { id: number; target: SpotTarget; text: string };

export type FlowState = {
  status: FlowStatus;
  live: number;
  /** The step the live turn is about (null between turns and on the paused / done turns). */
  step: StartStepKey | null;
  rules: RulesAsk;
  /** The rules turn: the plain-words proposal first, then the secure step with that draft. */
  rulesPhase: 'propose' | 'sign';
  /** "Change something" was pressed: her next words in the ask box are read as a change. */
  changing: boolean;
  /** The practice shop's pairing waiting for its four words (JSON of the pairing id), or null. */
  pairing: string | null;
  /** Each step's newest turn: an older turn of the same step was offered again below and says nothing more. */
  lastOf: Partial<Record<StartStepKey, number>>;
  spot: Spot | null;
};

const FRESH: FlowState = { status: 'new', live: 0, step: null, rules: RULES_START, rulesPhase: 'propose', changing: false, pairing: null, lastOf: {}, spot: null };
let state: FlowState = FRESH;
let key: string | null = null;
const subs = new Set<() => void>();

export const flowState = (): FlowState => state;

export function setFlow(patch: Partial<FlowState>): void {
  state = { ...state, ...patch };
  if (key && ('status' in patch || 'rules' in patch)) {
    try { localStorage.setItem(key, JSON.stringify({ status: state.status, rules: state.rules })); } catch { /* blocked: the session keeps it */ }
  }
  subs.forEach((f) => f());
}

/** Per world: the first-run preview keeps its own (its wallet is a world of its own too). */
export const flowKey = (firstRun: boolean): string => `table-setup-guide${firstRun ? ':first-run' : ''}`;

/** Loads the saved status and proposal for a world; an open turn from an earlier visit resumes as active. */
export function loadFlow(k: string): FlowState {
  key = k;
  let saved: Partial<Pick<FlowState, 'status' | 'rules'>> = {};
  try { saved = JSON.parse(localStorage.getItem(k) ?? '{}') as typeof saved; } catch { saved = {}; }
  const status: FlowStatus = saved.status === 'active' || saved.status === 'skipped' || saved.status === 'finished' ? saved.status : 'new';
  const r = saved.rules;
  const rules = r && [r.perDeal, r.perDay, r.askAbove].every((n) => Number.isInteger(n) && n >= 0) && typeof r.ends === 'string' ? r : RULES_START;
  state = { ...FRESH, status, rules };
  subs.forEach((f) => f());
  return state;
}

/** Tests: forget the in-memory flow (storage is cleared by the test itself). */
export function resetFlow(): void {
  state = FRESH;
  key = null;
  subs.forEach((f) => f());
}

export function useFlow(): FlowState {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, flowState, flowState);
}

/** A new open turn: its serial (older turns fold). */
export function nextLive(step: StartStepKey | null): number {
  const live = state.live + 1;
  setFlow({ live, step, changing: false, ...(step ? { lastOf: { ...state.lastOf, [step]: live } } : {}) });
  return live;
}

let spotN = 0;
/** Puts the one spotlight mark up (replacing any other). */
export function spotOn(target: SpotTarget, text: string): void { setFlow({ spot: { id: ++spotN, target, text } }); }
export function spotOff(id?: number): void { if (state.spot && (id === undefined || state.spot.id === id)) setFlow({ spot: null }); }

// ---- the steps, in the owner's order ---------------------------------------------------------------
// Three turns: keys, rules, then one practice turn that holds the agent app and the practice shop
// (owner, round 5: "fold agent app into practice step"). The wallet still counts four facts
// (START_ORDER); the practice turn is done when both of its facts are. The rules can come before the
// shop because their proposal names the shop's payee up front (rules.ts).
export const ORDER: readonly StartStepKey[] = START_ORDER.filter((k) => k !== 'engine');

/** One wallet fact (useStart), as the world reports it. */
export const factDone = (gs: GettingStarted, k: StartStepKey): boolean => gs.steps.find((s) => s.key === k)?.state === 'done';
/** A turn's step done: the practice turn needs its agent app chosen too. */
export const isDone = (gs: GettingStarted, k: StartStepKey): boolean =>
  k === 'practice' ? factDone(gs, 'practice') && factDone(gs, 'engine') : factDone(gs, k);
/** Every step's state is read (nothing 'unknown'): only then may the flow say which one is next. */
export const allKnown = (gs: GettingStarted): boolean => gs.steps.length > 0 && gs.steps.every((s) => s.state !== 'unknown');
/** The first step the world does not call done, in the owner's order; null when all are. */
export const firstTodo = (gs: GettingStarted): StartStepKey | null => ORDER.find((k) => !isDone(gs, k)) ?? null;
/** The step's number in that order (1-based) and the total. */
export const stepN = (k: StartStepKey): number => ORDER.indexOf(k) + 1;
