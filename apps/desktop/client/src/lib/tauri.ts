import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { ArgsOf, Backend, CommandName, EventName, InvokeOptions, PayloadOf, ResultOf, WindowLabel } from './contract';
import { toWalletError } from './contract';

/**
 * The real shell. Rust emits with `emit_to(label)`, never a broadcast, so we listen on the
 * current webview window (which receives events targeted at its label).
 * Non-null args travel as `{args: payload}`; null args send no payload (STATUS client handoff).
 */
export function tauriBackend(): Backend {
  const win = getCurrentWebviewWindow();
  const label = win.label as WindowLabel;
  return {
    kind: 'tauri',
    label,
    async invoke<K extends CommandName>(cmd: K, args: ArgsOf<K>, opts?: InvokeOptions): Promise<ResultOf<K>> {
      const payload = args === null ? undefined : { args };
      const options = opts?.token ? { headers: { 'X-Wallet-Ipc': opts.token } } : undefined;
      try {
        return await tauriInvoke<ResultOf<K>>(cmd, payload, options);
      } catch (e) {
        throw toWalletError(e);
      }
    },
    async listen<E extends EventName>(event: E, cb: (payload: PayloadOf<E>) => void) {
      return win.listen<PayloadOf<E>>(event, (e) => cb(e.payload));
    },
  };
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
