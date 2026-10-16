import type { Backend, WindowLabel } from './contract';
import { WalletError } from './contract';
import {
  DEMO_FALLBACK_KEY, DEMO_KEY, DEMO_NOTICE_KEY, DEMO_PARAM, DEMO_RETURN_KEY, leaveDemoApproval, openDemoApproval, pinDemo, resolveDemo, type DemoEnv, type DemoState,
} from './preview';
import { isTauri, tauriBackend } from './tauri';

let current: Backend | null = null;

/** What this page knows about itself at startup (the inputs of preview.ts resolveDemo). */
export function demoEnv(label: WindowLabel): DemoEnv {
  let stored: string | null = null;
  try { stored = localStorage.getItem(DEMO_KEY); } catch { /* no storage: the live wallet */ }
  let framed = false;
  try { framed = window.parent !== window; } catch { framed = true; }
  let returnTo: string | null = null;
  try { returnTo = sessionStorage.getItem(DEMO_RETURN_KEY); } catch { /* no session: not the sample approval */ }
  return { native: isTauri(), label, framed, search: location.search, stored, returnTo };
}

/**
 * One backend per page. Inside the Tauri shell it is the real IPC, unless the owner chose demo mode
 * for the main window (lib/preview.ts resolveDemo). In a plain browser (`pnpm dev`, design review,
 * Playwright) and in demo mode it is the mock, loaded lazily so the mock and its sample data never
 * ship inside the desktop bundle's critical path.
 *
 * Demo mode in the desktop app: the shell's IPC is sealed for this page before the mock starts
 * (`sealShell`), so nothing on the page, through any import, reaches the wallet, its keychain or
 * PayPal; the sample approval opens in this same webview (approval.html, demo-marked), never as a
 * window, and comes back here.
 *
 * If the sample data cannot load in the desktop app (the mock chunk is missing), the demo choice is
 * cleared and the page reloads once into the live wallet, which shows a one-line note; a second
 * failure in the same session goes live in place instead of reloading again (no loop).
 */
export async function initBackend(expected: WindowLabel, env: DemoEnv = demoEnv(expected), deps: RuntimeDeps = {}): Promise<Backend> {
  if (current) return current;
  const choice = resolveDemo(env);
  pinDemo(choice);
  if (choice.kind === 'live') {
    try { sessionStorage.removeItem(DEMO_FALLBACK_KEY); } catch { /* nothing to forget */ }
    current = tauriBackend();
    return current;
  }
  const load = deps.loadMock ?? (() => import('../mock/backend'));
  let mod: Awaited<ReturnType<typeof load>>;
  try {
    mod = await load();
  } catch (e) {
    if (!env.native) throw e;
    return fallBackToLive(expected, deps);
  }
  if (env.native) sealShell();
  if (expected === 'approval' && new URLSearchParams(env.search).get(DEMO_PARAM) === '1') escapeLeaves();
  current = mod.mockBackend(expected, { open: demoOpener(expected, env, choice.state, deps.go) });
  return current;
}

/** Test seams for initBackend: how the mock is loaded, how the page reloads or goes back. */
export type RuntimeDeps = {
  loadMock?: () => Promise<typeof import('../mock/backend')>;
  reload?: () => void;
  /** How the page goes to another page of the app (the sample approval and back). */
  go?: (url: string) => void;
};

/** The sample data could not load (desktop app): clear the choice, note it, reload once. The shell
 *  is not sealed yet at this point, so going live in place is safe. */
function fallBackToLive(expected: WindowLabel, deps: RuntimeDeps): Promise<Backend> {
  let tried = true;
  try {
    tried = sessionStorage.getItem(DEMO_FALLBACK_KEY) === '1';
    sessionStorage.setItem(DEMO_FALLBACK_KEY, '1');
    sessionStorage.removeItem(DEMO_RETURN_KEY);
    localStorage.setItem(DEMO_KEY, 'off');
    localStorage.setItem(DEMO_NOTICE_KEY, '1');
  } catch { /* storage blocked: go live here, no reload */ }
  if (!tried) {
    // The sample approval goes back to the main page; the main page reloads itself.
    (deps.reload ?? (() => (expected === 'main' ? location.reload() : location.assign('index.html'))))();
    return new Promise<Backend>(() => undefined); // the page is going away
  }
  pinDemo({ kind: 'live' });
  current = tauriBackend();
  return Promise.resolve(current);
}

export function backend(): Backend {
  if (!current) throw new Error('backend not initialised - call initBackend() in the window entry');
  return current;
}

/** Tests only: forget this page's backend and demo choice, as a reload would. */
export function resetBackendForTests(): void {
  current = null;
  pinDemo(null);
}

/** The refusal every sealed IPC call gets: demo mode never talks to the wallet. */
export const DEMO_SEALED = 'demo mode: the wallet is not called';

/**
 * Demo mode in the desktop app: replace the page's IPC entry points so that any call, from this
 * code or from a library, fails at once instead of reaching the shell. The page reloads to leave
 * demo mode, which gives it a fresh IPC. Best effort per property: a property the shell made
 * read-only stays, and the page still never calls it (the backend is the mock).
 */
export function sealShell(w: Window = window): void {
  const internals = (w as unknown as { __TAURI_INTERNALS__?: Record<string, unknown> }).__TAURI_INTERNALS__;
  if (!internals) return;
  const refuse = () => Promise.reject(new WalletError({ code: 'PERMISSION', message: DEMO_SEALED }));
  for (const k of ['invoke', 'ipc'] as const) {
    if (!(k in internals)) continue;
    try {
      Object.defineProperty(internals, k, { value: refuse, writable: false, configurable: false });
    } catch {
      try { internals[k] = refuse; } catch { /* read-only: never called (see above) */ }
    }
  }
}

/**
 * Where the mock's windows go in demo mode. The main window (top level) goes to the sample approval
 * in its own webview; in the desktop app nothing else opens (a window would be a real one). The
 * sample approval goes back to The Table where it would open the main window. Any other page (the
 * browser preview's Tumbler, the director's frames) opens windows as before.
 */
function demoOpener(label: WindowLabel, env: DemoEnv, state: DemoState, go?: (url: string) => void): ((page: string, name: string, features?: string) => void) | undefined {
  const isApproval = (page: string) => page.startsWith('approval.html');
  if (label === 'main' && !env.framed) {
    return (page, name, features) => {
      if (isApproval(page)) openDemoApproval(page, state, go);
      else if (!env.native) window.open(page, name, features);
    };
  }
  if (label === 'approval' && env.returnTo !== null) {
    return (page, name, features) => {
      if (leaveDemoApproval(go)) return;
      if (!env.native) window.open(page, name, features);
    };
  }
  return env.native ? () => undefined : undefined;
}

/** The sample approval: Esc that no layer of its own took, and not inside a field, goes back to
 *  The Table (the real approval window has no such key; it is never this page). */
function escapeLeaves(): void {
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const t = e.target instanceof HTMLElement ? e.target : null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    leaveDemoApproval();
  });
}
