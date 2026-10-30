// The sentence the owner said, kept for as long as the window lives, so it can be said on the Charter and
// seen on the Rewind's timeline without saying it twice. Plain module state behind useSyncExternalStore:
// no IPC, no storage, nothing leaves the window. The reading is derived from it (never stored), so a
// moved clock or a newly connected wallet re-reads the same words.
import { useSyncExternalStore } from 'react';
import type { Answers } from './read';

export type SayState = { text: string; answers: Answers };

const EMPTY: SayState = { text: '', answers: {} };
let state: SayState = EMPTY;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export const sayState = (): SayState => state;

/** A new sentence: what was answered or edited about the old one no longer applies. */
export function saySet(text: string): void {
  if (text === state.text) return;
  state = { text, answers: {} };
  emit();
}

/** An answer to a question, or an edit of a chip (read.ts: a question id, or a slot name). */
export function sayAnswer(id: string, value: string): void {
  state = { ...state, answers: { ...state.answers, [id]: value } };
  emit();
}

/** Take back one answer or edit. */
export function sayUnanswer(id: string): void {
  if (!(id in state.answers)) return;
  const { [id]: _gone, ...rest } = state.answers;
  void _gone;
  state = { ...state, answers: rest };
  emit();
}

export function sayClear(): void {
  if (state === EMPTY) return;
  state = EMPTY;
  emit();
}

export function useSayState(): SayState {
  return useSyncExternalStore(subscribe, sayState, sayState);
}
