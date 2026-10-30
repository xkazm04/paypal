// The sentence the owner said, kept for as long as the window lives, so it can be said on the Charter and
// seen on the Rewind's timeline without saying it twice. Plain module state behind useSyncExternalStore:
// no IPC, nothing sent anywhere. It is also kept in this window's own storage (the owner's words, not a
// secret), so a reload does not lose a half-said rule and a framed window of the browser preview follows
// the director's. The reading is derived from it (never stored), so a moved clock or a newly connected
// wallet re-reads the same words.
import { useSyncExternalStore } from 'react';
import type { Answers } from './read';

export type SayState = { text: string; answers: Answers };

const KEY = 'table.say';
const EMPTY: SayState = { text: '', answers: {} };

function load(): SayState {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const v = JSON.parse(raw) as { text?: unknown; answers?: unknown };
    if (typeof v.text !== 'string' || !v.text) return EMPTY;
    const answers = Object.fromEntries(Object.entries((v.answers ?? {}) as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'));
    return { text: v.text.slice(0, 400), answers };
  } catch {
    return EMPTY;
  }
}
function save(s: SayState): void {
  try {
    if (s.text) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch { /* no storage: the sentence lives in this window only */ }
}

let state: SayState = load();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
// Another window of the same browser (the director's frames) said something: follow it.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    state = load();
    emit();
  });
}

export const sayState = (): SayState => state;

/** A new sentence: what was answered or edited about the old one no longer applies. */
export function saySet(text: string): void {
  if (text === state.text) return;
  state = text ? { text, answers: {} } : EMPTY;
  save(state);
  emit();
}

/** An answer to a question, or an edit of a chip (read.ts: a question id, or a slot name). */
export function sayAnswer(id: string, value: string): void {
  state = { ...state, answers: { ...state.answers, [id]: value } };
  save(state);
  emit();
}

/** Take back one answer or edit. */
export function sayUnanswer(id: string): void {
  if (!(id in state.answers)) return;
  const { [id]: _gone, ...rest } = state.answers;
  void _gone;
  state = { ...state, answers: rest };
  save(state);
  emit();
}

export function sayClear(): void {
  if (state === EMPTY) return;
  state = EMPTY;
  save(state);
  emit();
}

export function useSayState(): SayState {
  return useSyncExternalStore(subscribe, sayState, sayState);
}
