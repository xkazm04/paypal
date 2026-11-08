// Chat flows (spark chat-configure): Rules, Settings, Connections and Rewind as short sequences of
// single-question cards in the Chat. ONE flow is live at a time; an older card folds to its summary
// line. State is in memory only (a reload starts clean) and nothing here reads or writes the wallet:
// a flow's card does that through the same commands the full pages use. No wire change: flows start
// from a chip, a slash command or typed words (intent.ts), never from a model reply.
import { useSyncExternalStore } from 'react';

export type FlowKind = 'rules' | 'settings' | 'connections' | 'rewind';
export const FLOW_KINDS: readonly FlowKind[] = ['rules', 'settings', 'connections', 'rewind'];

/** One turn of a flow in the transcript: the live one is open, older ones show only `summary`. */
export type FlowTurn = {
  /** Unique, increasing: the transcript key and the order. */
  serial: number;
  kind: FlowKind;
  /** The card's own step name (each flow component defines its steps). */
  step: string;
  /** What the owner chose so far, one line; null while the step is still open, '' when it was left. */
  summary: string | null;
  /** A step's answers, kept only for the card that renders it (opaque to the store). */
  data: Readonly<Record<string, unknown>>;
};

export type FlowState = {
  /** The turns of this visit, oldest first; the turn with `summary === null` is the live card. */
  turns: readonly FlowTurn[];
  /** The kind of the live flow, or null when none is open. */
  live: FlowKind | null;
};

const EMPTY: FlowState = { turns: [], live: null };
let state: FlowState = EMPTY;
let serial = 0;
const subs = new Set<() => void>();
const emit = (next: FlowState): void => { state = next; subs.forEach((f) => f()); };

export const flowState = (): FlowState => state;
export function useFlows(): FlowState {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, flowState, flowState);
}

/** The first card of the flows whose steps are not named 'start' (Rules and Settings begin at their first question). */
const ENTRY: Partial<Record<FlowKind, string>> = { rules: 'perDeal', settings: 'topic' };

/** Starts a flow at `step` ('start' = the flow's own first card): any open turn folds as left (summary ''). Returns the new turn's serial. */
export function startFlow(kind: FlowKind, step: string, data: FlowTurn['data'] = {}): number {
  if (step === 'start') step = ENTRY[kind] ?? 'start';
  const turns = state.turns.map((t) => (t.summary === null ? { ...t, summary: '' } : t));
  const n = ++serial;
  emit({ turns: [...turns, { serial: n, kind, step, summary: null, data }], live: kind });
  return n;
}

/** Moves the live flow to its next step: the open turn gets `summary`, a new open turn follows. */
export function advanceFlow(summary: string, step: string, data: FlowTurn['data'] = {}): number | null {
  const open = [...state.turns].reverse().find((t) => t.summary === null);
  if (!open) return null;
  const turns = state.turns.map((t) => (t.serial === open.serial ? { ...t, summary } : t));
  const n = ++serial;
  emit({ turns: [...turns, { serial: n, kind: open.kind, step, summary: null, data }], live: open.kind });
  return n;
}

/** Ends the live flow: the open turn gets `summary` (the card's closing line) and nothing follows. */
export function endFlow(summary: string): void {
  const open = [...state.turns].reverse().find((t) => t.summary === null);
  if (!open) return;
  emit({ turns: state.turns.map((t) => (t.serial === open.serial ? { ...t, summary } : t)), live: null });
}

/** Tests: forget every turn. */
export function resetFlows(): void { serial = 0; emit(EMPTY); }
