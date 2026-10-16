// Restarting after Resume (runtime-actor-and-engines B). resume_all_agents returns the tables
// waiting on your agent and starts none of them; the owner's one click starts each with its own
// agent_start, never more than the wallet's run limit at once (engines.rs start_agent). A refused
// start is reported for that table and never retried: the owner can click again.

/** The wallet's limit on runs at once (Rust `start_agent` refuses past it). */
export const RUN_CAP = 4;

export interface RestartPlan {
  /** Started now, in the order given (soonest deadline first). */
  start: string[];
  /** Over the run limit: they wait for a free slot and the owner's next click. */
  later: string[];
}

/** Which waiting tables fit in the free run slots now. */
export function restartPlan(waiting: readonly string[], running: number, cap: number = RUN_CAP): RestartPlan {
  const free = Math.max(0, cap - Math.max(0, running));
  return { start: waiting.slice(0, free), later: waiting.slice(free) };
}

export interface RestartResult {
  started: string[];
  refused: { deal_id: string; error: unknown }[];
}

/** One start per table, in order, one at a time; a refusal is kept for that table, not retried. */
export async function restartTables(ids: readonly string[], start: (id: string) => Promise<unknown>): Promise<RestartResult> {
  const out: RestartResult = { started: [], refused: [] };
  for (const id of ids) {
    try {
      await start(id);
      out.started.push(id);
    } catch (error) {
      out.refused.push({ deal_id: id, error });
    }
  }
  return out;
}
