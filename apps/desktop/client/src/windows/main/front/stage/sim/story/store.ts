// sim STORY: where the owner is in her first-deal story, kept outside React so every card the story
// put into Stage's transcript (host.say) reads the same value and a reload resumes where she left.
// Only the story's own place is kept here (phase, goal, her practice decision); whether a setup step
// is DONE is never stored here: that is the wallet's (useStart), read live.
import { useSyncExternalStore } from 'react';
import type { StartStepKey } from '../../../../../../lib/words';
import { firstRunPreview } from '../../../../../../lib/preview';
import type { GoalId } from './words';

export type Phase = 'goal' | 'engine' | 'shop' | 'rules' | 'deal' | 'keys' | 'done';
export const PHASES: readonly Phase[] = ['goal', 'engine', 'shop', 'rules', 'deal', 'keys', 'done'];
/** The setup step each phase completes (goal, deal and done complete none). */
export const STEP_OF: Partial<Record<Phase, StartStepKey>> = { engine: 'engine', shop: 'practice', rules: 'rules', keys: 'paypal' };

export type StoryState = {
  phase: Phase;
  goal: GoalId | null;
  /** Her answer at the practice deal's decision moment (simulated: never reaches the wallet). */
  decision: 'accept' | 'walk' | null;
  /** She chose "Skip for now": the story waits for "Continue setup". */
  paused: boolean;
};

const START: StoryState = { phase: 'goal', goal: null, decision: null, paused: false };
/** Per preview world, so the sample week and a first-run wallet never share a story. */
const key = (): string => `spark-story${firstRunPreview() ? ':first-run' : ''}`;

function load(): StoryState {
  try {
    const raw = localStorage.getItem(key());
    if (!raw) return START;
    const v = JSON.parse(raw) as Partial<StoryState>;
    return {
      phase: PHASES.includes(v.phase as Phase) ? (v.phase as Phase) : 'goal',
      goal: v.goal === 'haggle' || v.goal === 'askFirst' ? v.goal : null,
      decision: v.decision === 'accept' || v.decision === 'walk' ? v.decision : null,
      paused: v.paused === true,
    };
  } catch {
    return START;
  }
}

let state: StoryState | null = null;
const listeners = new Set<() => void>();

export function story(): StoryState {
  if (!state) state = load();
  return state;
}

export function setStory(patch: Partial<StoryState>): void {
  state = { ...story(), ...patch };
  try { localStorage.setItem(key(), JSON.stringify(state)); } catch { /* storage blocked: the story lives for this page only */ }
  for (const l of listeners) l();
}

export function useStory(): StoryState {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, story, story);
}

/** Tests only: forget the story, as a fresh browser would. */
export function resetStoryForTests(): void {
  state = null;
  try { localStorage.removeItem(key()); } catch { /* nothing kept */ }
}
