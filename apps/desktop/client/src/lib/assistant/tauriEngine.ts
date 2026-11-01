// In-app engine: the desktop shell's `assistant_ask` (read tier, main window only, answered by the
// shell itself). The shell runs one tool-less `claude-code` turn in an empty directory with secrets
// stripped from its environment, behind a conformance check, a busy flag, a per-minute count, a 60 s
// deadline and an output cap (crates/table-engine/src/assistant.rs). The page sends ONE text: the
// question and the board digest exactly as the dev bridge writes them to the CLI (buildDigest: no
// counterparty text). The shell owns the system prompt and the reply schema: a pinned copy of
// prompt.ts / vocabulary.ts (crates/table-client/src/assistant_contract.json, bound by this file's
// test). The reply comes back as raw JSON text and stays untrusted: the caller runs validateReply.
// Any failure throws Error(reason) ('unavailable' | 'timeout' | 'bad_output' | 'busy' | 'bad_request'
// | 'aborted') so the board answers from the scripted engine and says so.
import type { Backend } from '../contract';
import { WalletError } from '../contract';
import { type AssistantEngine, type DigestInput } from './contract';
import { buildDigest } from './digest';

/** The shell's own deadline is 60 s; the page waits a little longer, then gives up on the answer. */
export const TAURI_TIMEOUT_MS = 65_000;
/** The dev bridge's question cap, kept here because the shell only sees the joined text. */
export const QUESTION_MAX = 500;

/** The one text that crosses: the question, a blank line, the board digest. */
export function assistantText(question: string, input: DigestInput): string {
  return `${question}\n\n${buildDigest(input)}\n`;
}

const reasonOf = (e: unknown): string => {
  if (e instanceof WalletError) {
    if (e.code === 'REFUSED') return 'busy';
    if (e.code === 'INVALID') return 'bad_request';
  }
  return 'unavailable';
};

/** `getBackend` is the page's backend (lib/runtime). Only the real shell is ever asked. */
export function createTauriEngine(getBackend: () => Backend): AssistantEngine {
  return {
    info: { id: 'claude-code', label: 'claude-code' },
    async ask(question, input, signal) {
      if (signal?.aborted) throw new Error('aborted');
      if (question.trim() === '' || question.length > QUESTION_MAX) throw new Error('bad_request');
      const b = getBackend();
      if (b.kind !== 'tauri' || b.label !== 'main') throw new Error('unavailable');
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;
      // An IPC call cannot be withdrawn: on abort or timeout the page stops waiting and drops the
      // late answer; the shell still ends that turn by its own deadline.
      const stop = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), TAURI_TIMEOUT_MS);
        onAbort = () => reject(new Error('aborted'));
        signal?.addEventListener('abort', onAbort, { once: true });
      });
      try {
        const call = b.invoke('assistant_ask', { text: assistantText(question, input) }).catch((e: unknown) => {
          throw new Error(reasonOf(e));
        });
        const text = await Promise.race([call, stop]);
        if (typeof text !== 'string') throw new Error('bad_output');
        try {
          return JSON.parse(text) as unknown;
        } catch {
          throw new Error('bad_output');
        }
      } finally {
        clearTimeout(timer);
        if (onAbort) signal?.removeEventListener('abort', onAbort);
      }
    },
  };
}

/** True when the shell says a question would be tried (no model runs for this). Never throws. */
export async function tauriAssistantAvailable(getBackend: () => Backend): Promise<boolean> {
  try {
    const b = getBackend();
    if (b.kind !== 'tauri' || b.label !== 'main') return false;
    const status = await b.invoke('assistant_status', null);
    return status.available === true;
  } catch {
    return false;
  }
}
