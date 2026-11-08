// The agent app's state, told once for every window. Footer, Set up (Charter), the Tumbler's
// welcome and the approval window's wallet setup all ask `engine_brief` (which every window may
// read: id and available, never a version or a probe's reason) and map it here, so no two
// surfaces can disagree about "connected". While a read has not answered, or the chosen app is not
// in the answer, the state is `unknown` (shown dashed / checking), never "not connected".
import type { EngineBrief } from '@bindings/EngineBrief';
import type { EngineId } from '@bindings/EngineId';
import { useQuery } from './hooks';

export type AgentAppState =
  | { kind: 'connected'; engine: EngineId }
  | { kind: 'not-connected'; engine: EngineId }
  | { kind: 'unknown' };

/** The state of the chosen agent app; `unknown` until both the briefs and the choice are read. */
export function agentAppState(briefs: readonly Pick<EngineBrief, 'id' | 'available'>[] | null | undefined, selected: EngineId | null | undefined): AgentAppState {
  if (!briefs || !selected) return { kind: 'unknown' };
  const b = briefs.find((e) => e.id === selected);
  if (!b) return { kind: 'unknown' };
  return b.available ? { kind: 'connected', engine: selected } : { kind: 'not-connected', engine: selected };
}

/** The tri-state fact the getting-started steps take (null = not known here). */
export function agentAppAvailable(state: AgentAppState): boolean | null {
  return state.kind === 'unknown' ? null : state.kind === 'connected';
}

/** Reads engine_brief and answers for the chosen app. Works in every window. */
export function useAgentApp(selected: EngineId | null | undefined): { state: AgentAppState; error: boolean; briefs: readonly EngineBrief[] | null } {
  const q = useQuery('engine_brief', null, { refreshOn: ['settings:changed'] });
  return { state: agentAppState(q.data, selected), error: !!q.error, briefs: q.data ?? null };
}
