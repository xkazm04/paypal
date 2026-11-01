// Client side of the dev bridge to the claude-code CLI. STUB (WP2): final signature. Contract of the
// real one: POST BRIDGE_PATH with a BridgeRequest, 45 s client timeout, AbortSignal honoured; a
// BridgeResponse with ok:false (or a network error) throws an Error whose message is the reason,
// so the caller falls back to the scripted engine and says so.
import type { AssistantEngine } from './contract';

export function createBridgeEngine(): AssistantEngine {
  return {
    info: { id: 'claude-code', label: 'claude-code' },
    async ask() {
      throw new Error('unavailable');
    },
  };
}

/** True when the dev bridge answers a probe (browser dev server only). */
export async function bridgeAvailable(): Promise<boolean> {
  return false;
}
