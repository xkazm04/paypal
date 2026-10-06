import type { Backend, WindowLabel } from './contract';
import { isTauri, tauriBackend } from './tauri';

let current: Backend | null = null;

/**
 * One backend per page. Inside the Tauri shell it is the real IPC. In a plain browser
 * (`pnpm dev`, design review, Playwright) it is the mock, loaded lazily so the mock and its
 * sample data never ship inside the desktop bundle's critical path.
 */
export async function initBackend(expected: WindowLabel): Promise<Backend> {
  if (current) return current;
  if (isTauri()) {
    current = tauriBackend();
  } else {
    const { mockBackend } = await import('../mock/backend');
    current = mockBackend(expected);
  }
  return current;
}

export function backend(): Backend {
  if (!current) throw new Error('backend not initialised - call initBackend() in the window entry');
  return current;
}
