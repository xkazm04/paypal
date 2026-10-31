// The browser preview's worlds: `?first_run=1` opens a brand-new wallet in a world of its own, so
// anything a window stores (the mock's state, the tour's progress) gets its own key there and the
// sample week stays untouched. Dependency-free, so a window can ask without loading the mock
// (src/mock/firstRun.ts re-exports these for the mock backend).
//
// Demo mode (polish wave): the same worlds, chosen from the main window's footer. In a browser the
// address is the truth (`?scale=`, `?first_run=1`, `?degrade=1`, `?locked=1`, as before); in the
// desktop app the owner's choice is kept in localStorage `table-demo` and read once at startup, for
// the main window (and the sample approval it frames) only: the Tumbler and the real approval window
// never read it. Every reader below asks `previewSearch()`, which is the address in a browser and
// the address plus the chosen world in a desktop demo, so the mock, the tour and the badges agree.
import type { WindowLabel } from './contract';

export const FIRST_RUN_PARAM = 'first_run';

/** True when this page was opened as a first-run preview (`?first_run=1`). */
export function firstRunPreview(search: string = previewSearch()): boolean {
  try {
    return new URLSearchParams(search).get(FIRST_RUN_PARAM) === '1';
  } catch {
    return false;
  }
}

// `?scale=small|large` opens the same sample wallet at two realistic sizes (src/mock/scale.ts):
// a one-person shop, or a busy merchant. Like first_run it is a world of its own (own storage key
// and broadcast channel), so the default sample week stays untouched. A brand-new wallet
// (`first_run=1`) has no data to scale, so it wins when both are given.

export const SCALE_PARAM = 'scale';
export type ScaleName = 'small' | 'large';

/** The scale this page was opened at (`?scale=small|large`), or null: the default sample week. */
export function scalePreview(search: string = previewSearch()): ScaleName | null {
  try {
    const q = new URLSearchParams(search);
    if (q.get(FIRST_RUN_PARAM) === '1') return null;
    const v = q.get(SCALE_PARAM);
    return v === 'small' || v === 'large' ? v : null;
  } catch {
    return null;
  }
}

// `?film_ending=today|say` is the director's film switch (director/stories.ts): Maya's film ends on the
// Rewind as it always did (`today`: no Say it panel, no forecast past now), or on Say it and the timeline
// past now (`say`). The director puts it on the main frame's address; a page without it, and the desktop
// app always, shows the Say it panel and the timeline. It changes what is drawn, never what is read or sent.

export const FILM_ENDING_PARAM = 'film_ending';
export type FilmEnding = 'today' | 'say';
export const FILM_ENDINGS: readonly FilmEnding[] = ['today', 'say'];

/** The film ending this page was framed for (`?film_ending=`), or null: the app as it is. */
export function filmEndingPreview(search: string = previewSearch()): FilmEnding | null {
  if (inDesktopApp()) return null;
  try {
    const v = new URLSearchParams(search).get(FILM_ENDING_PARAM);
    return v === 'today' || v === 'say' ? v : null;
  } catch {
    return null;
  }
}

/** The storage key and broadcast channel of the world a page belongs to. */
export function worldKeys(store: string, channel: string, firstRun: boolean, scale: ScaleName | null = null): { store: string; channel: string } {
  if (firstRun) return { store: `${store}:first-run`, channel: `${channel}:first-run` };
  return scale ? { store: `${store}:scale-${scale}`, channel: `${channel}:scale-${scale}` } : { store, channel };
}

// ---- demo mode ----------------------------------------------------------------------------------

/** Where the desktop app keeps the owner's demo choice (`off`, or a world with `+degrade`/`+locked`). */
export const DEMO_KEY = 'table-demo';
/** Marks the sample approval page the main window opens in demo mode (`approval.html?demo=1`). */
export const DEMO_PARAM = 'demo';
export const DEGRADE_PARAM = 'degrade';
export const LOCKED_PARAM = 'locked';

/** The sample worlds: the default sample week, a one-person shop, a busy merchant, a new wallet. */
export type DemoWorld = 'sample' | ScaleName | 'first_run';
export const DEMO_WORLDS: readonly DemoWorld[] = ['small', 'large', 'first_run', 'sample'];
/** A demo choice: which world, and whether it plays an older app version or a locked wallet. */
export type DemoState = { world: DemoWorld; degrade: boolean; locked: boolean };

const isWorld = (v: string): v is DemoWorld => (DEMO_WORLDS as readonly string[]).includes(v);

/** The stored choice (`large+degrade`), or null: off, absent or unreadable (an unreadable choice
 *  falls back to the live wallet, never to a guessed world). */
export function parseDemo(raw: string | null | undefined): DemoState | null {
  if (!raw) return null;
  const [world = '', ...flags] = raw.trim().split('+');
  if (!isWorld(world)) return null;
  return { world, degrade: flags.includes('degrade'), locked: flags.includes('locked') };
}

/** The stored form of a choice; null is `off`. */
export function formatDemo(s: DemoState | null): string {
  if (!s) return 'off';
  return [s.world, ...(s.degrade ? ['degrade'] : []), ...(s.locked ? ['locked'] : [])].join('+');
}

/** The world an address asks for (a browser preview): no parameter is the default sample week. */
export function demoFromSearch(search: string): DemoState {
  try {
    const q = new URLSearchParams(search);
    const scale = q.get(SCALE_PARAM);
    const world: DemoWorld = q.get(FIRST_RUN_PARAM) === '1' ? 'first_run' : scale === 'small' || scale === 'large' ? scale : 'sample';
    return { world, degrade: q.get(DEGRADE_PARAM) === '1', locked: q.get(LOCKED_PARAM) === '1' };
  } catch {
    return { world: 'sample', degrade: false, locked: false };
  }
}

/** `search` with its world parameters replaced by `s`'s (every other parameter kept, in order). */
export function withDemoSearch(search: string, s: DemoState): string {
  const q = new URLSearchParams(search);
  for (const k of [FIRST_RUN_PARAM, SCALE_PARAM, DEGRADE_PARAM, LOCKED_PARAM]) q.delete(k);
  if (s.world === 'first_run') q.set(FIRST_RUN_PARAM, '1');
  else if (s.world !== 'sample') q.set(SCALE_PARAM, s.world);
  if (s.degrade) q.set(DEGRADE_PARAM, '1');
  if (s.locked) q.set(LOCKED_PARAM, '1');
  const out = q.toString();
  return out ? `?${out}` : '';
}

/** What a page knows about itself when it starts. */
export type DemoEnv = {
  /** Inside the desktop app (the shell's IPC is present). */
  native: boolean;
  label: WindowLabel;
  /** The page is framed by another page (the director's frames). */
  framed: boolean;
  search: string;
  /** localStorage `table-demo` (null when absent or unreadable). */
  stored: string | null;
  /** sessionStorage `table-demo-return`: where the sample approval goes back to (set by the demo
   *  main window, in this same webview, just before it opened the sample approval). */
  returnTo: string | null;
};

/** Where a page's backend comes from: the shell, or a sample world (and why). */
export type DemoChoice =
  | { kind: 'live' }
  | { kind: 'demo'; state: DemoState; source: 'address' | 'stored' };

/**
 * The one rule (pure, tested). A browser page is always on sample data, its world from the address.
 * In the desktop app only the main window, top-level, reads the stored choice, and the sample
 * approval it opened in its own webview follows it (marked `demo=1` AND carrying the return place
 * the main window left in this webview's session); every other window is live whatever is stored.
 */
export function resolveDemo(env: DemoEnv): DemoChoice {
  if (!env.native) return { kind: 'demo', state: demoFromSearch(env.search), source: 'address' };
  const reads = (env.label === 'main' && !env.framed)
    || (env.label === 'approval' && env.returnTo !== null && new URLSearchParams(env.search).get(DEMO_PARAM) === '1');
  const state = reads ? parseDemo(env.stored) : null;
  return state ? { kind: 'demo', state, source: 'stored' } : { kind: 'live' };
}

// The choice this page started with (runtime.ts pins it once, before the first render).
let pinned: DemoChoice | null = null;

/** Called once by the window entry (lib/runtime.ts initBackend). */
export function pinDemo(c: DemoChoice | null): void {
  pinned = c;
}

/** The address the preview readers use: the page's own, plus the stored world in a desktop demo. */
export function previewSearch(): string {
  const own = typeof location === 'undefined' ? '' : location.search;
  return pinned?.kind === 'demo' && pinned.source === 'stored' ? withDemoSearch(own, pinned.state) : own;
}

/** A page the demo opens next to itself (the sample approval), in the same world, marked as demo. */
export function demoPageUrl(page: string, s: DemoState): string {
  const hash = page.indexOf('#');
  const [path, frag] = hash < 0 ? [page, ''] : [page.slice(0, hash), page.slice(hash)];
  const [base = '', query = ''] = path.split('?');
  const q = new URLSearchParams(withDemoSearch(query ? `?${query}` : '', s));
  q.set(DEMO_PARAM, '1');
  return `${base}?${q.toString()}${frag}`;
}

/** Inside the desktop app: the shell's IPC is present. The one test (lib/tauri.ts isTauri and
 *  lib/clock.ts use it); dependency-free, so a page can ask without loading the shell's API. */
export function inDesktopApp(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** This page's demo, for the footer's switcher: whether it runs in the desktop app, and the world
 *  it shows (null = the live wallet). A browser page is always on a world, from its address. */
export function demoNow(): { native: boolean; state: DemoState | null } {
  const native = inDesktopApp();
  const p = pinned;
  if (p) return { native, state: p.kind === 'demo' ? p.state : null };
  return native ? { native, state: null } : { native, state: demoFromSearch(typeof location === 'undefined' ? '' : location.search) };
}

// ---- the sample approval (demo mode) -------------------------------------------------------------
// In demo mode the mock's approval_open never opens a window: the main window goes, in its own
// webview, to the sample approval page (`approval.html?...&demo=1`, same world), after leaving its
// own address (route included) in this webview's session. "Back to The Table" and Esc there come
// back to that address. The real approval window is never involved.

/** sessionStorage: the main window's address to come back to from the sample approval. */
export const DEMO_RETURN_KEY = 'table-demo-return';
/** localStorage: a one-time note that the sample data could not open (runtime.ts fallback). */
export const DEMO_NOTICE_KEY = 'table-demo-notice';
/** sessionStorage: the fallback already reloaded this webview once (no reload loop). */
export const DEMO_FALLBACK_KEY = 'table-demo-fallback';

type Go = (url: string) => void;
const assign: Go = (url) => location.assign(url);

/** The demo main window opens the sample approval in place of itself. */
export function openDemoApproval(page: string, s: DemoState, go: Go = assign): void {
  try { sessionStorage.setItem(DEMO_RETURN_KEY, `${location.pathname}${location.search}${location.hash}`); } catch { /* no session: Back goes to the centre */ }
  go(demoPageUrl(page, s));
}

/** This page is the sample approval the demo main window opened (not the real approval window). */
export function demoApprovalPage(): boolean {
  if (pinned?.kind !== 'demo' || typeof location === 'undefined') return false;
  if (new URLSearchParams(location.search).get(DEMO_PARAM) !== '1') return false;
  try { return sessionStorage.getItem(DEMO_RETURN_KEY) !== null; } catch { return false; }
}

/** The sample approval's way back to The Table, at the route it was opened from. False when this
 *  page is not the sample approval (then the caller does what it always did). */
export function leaveDemoApproval(go: Go = assign): boolean {
  if (!demoApprovalPage()) return false;
  let back = 'index.html';
  try {
    back = sessionStorage.getItem(DEMO_RETURN_KEY) ?? back;
    sessionStorage.removeItem(DEMO_RETURN_KEY);
  } catch { /* the centre */ }
  go(back);
  return true;
}

/** The one-time note left by the fallback (read once, then gone). */
export function takeDemoNotice(): boolean {
  try {
    const v = localStorage.getItem(DEMO_NOTICE_KEY) === '1';
    if (v) localStorage.removeItem(DEMO_NOTICE_KEY);
    return v;
  } catch {
    return false;
  }
}
