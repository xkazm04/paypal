// Client side of the dev bridge to the claude-code CLI (browser dev server only). POST BRIDGE_PATH with
// a BridgeRequest; GET BRIDGE_PATH?probe=1 answers {ok:true}. 45 s client timeout, AbortSignal
// honoured. An ok:false response, a non-ok HTTP status or a network failure throws an Error whose
// message is a reason word ('unavailable' | 'timeout' | 'bad_output' | 'busy' | 'bad_request' |
// 'aborted'), so the caller falls back to the scripted engine and says so. The reply it returns is
// still untrusted: it goes through validateReply like every other.
import { BRIDGE_PATH, type AssistantEngine, type BridgeRequest, type BridgeResponse } from './contract';

export const BRIDGE_TIMEOUT_MS = 45_000;
export const BRIDGE_PROBE_MS = 3_000;
const REASONS = ['unavailable', 'timeout', 'bad_output', 'busy', 'bad_request'] as const;

const reasonOf = (v: unknown): string => (typeof v === 'string' && (REASONS as readonly string[]).includes(v) ? v : 'unavailable');

export function createBridgeEngine(): AssistantEngine {
  return {
    info: { id: 'claude-code', label: 'claude-code' },
    async ask(question, input, signal) {
      // Dev server only: a production build folds this to a throw and drops the fetch (and the path).
      if (!import.meta.env.DEV) throw new Error('unavailable');
      if (signal?.aborted) throw new Error('aborted');
      const ctl = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, BRIDGE_TIMEOUT_MS);
      const onAbort = (): void => ctl.abort();
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        const body: BridgeRequest = { question, digest: input };
        let res: Response;
        try {
          res = await fetch(BRIDGE_PATH, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
        } catch {
          throw new Error(timedOut ? 'timeout' : signal?.aborted ? 'aborted' : 'unavailable');
        }
        let json: BridgeResponse | null = null;
        try { json = (await res.json()) as BridgeResponse; } catch { json = null; }
        if (json && json.ok === true && res.ok) return json.reply;
        throw new Error(json && json.ok === false ? reasonOf(json.reason) : 'unavailable');
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
    },
  };
}

/** True when the dev bridge answers a probe (browser dev server only). Never throws. */
export async function bridgeAvailable(): Promise<boolean> {
  if (!import.meta.env.DEV) return false;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), BRIDGE_PROBE_MS);
  try {
    const res = await fetch(`${BRIDGE_PATH}?probe=1`, { method: 'GET', signal: ctl.signal });
    if (!res.ok) return false;
    const json = (await res.json()) as { ok?: unknown };
    return json.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
