// The deterministic engine: canned intents with keyword matching over the digest. Always available,
// the fallback for every other engine. STUB (WP2): final signature.
import type { AssistantEngine } from './contract';

export function createScriptedEngine(): AssistantEngine {
  return {
    info: { id: 'scripted', label: 'Scripted preview' },
    async ask() {
      return { v: 1, say: '', ops: [] };
    },
  };
}
