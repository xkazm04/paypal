// liveReach.ts - where live mode (live.ts) may look for a sandbox, and the arena's way to ask it to look.
//
// WHY a module of its own: live.ts keeps its exported surface as it was (the arena and liveView.test.tsx
// mock it whole), and the probe is a network request Chrome logs as a console error when nothing listens.
// A console error cannot be silenced from JS, so live mode never probes where it cannot apply:
// - inside the desktop app (the shell has no sandbox bridge; the console's place "Try to break it" plays
//   the recorded answers there),
// - under the director: its frames, a rehearsal or a film capture (lib/preview.ts underDirector).
// Elsewhere (the plain dev page, arena.html) it probes once on mount, then only when the window gets the
// focus back or the person asks with "Connect my agent app" (askForLive), never on a timer while absent.
import { inDesktopApp, underDirector, type DirectedEnv } from '../lib/preview';

/** The window event "Connect my agent app" sends; live.ts probes once when it hears it. */
export const LIVE_ASK_EVENT = 'table:live-ask';

/** What decides whether live mode may probe (pure, tested). */
export type LiveEnv = DirectedEnv & { desktop: boolean };

export function liveEnv(): LiveEnv {
  const search = typeof location === 'undefined' ? '' : location.search;
  let framed = false;
  try { framed = typeof window !== 'undefined' && window.parent !== window; } catch { framed = true; }
  return { search, framed, desktop: inDesktopApp() };
}

/** True where a judge's own agent app can play live: a plain browser page, not played or recorded. */
export function liveApplies(env: LiveEnv = liveEnv()): boolean {
  return !env.desktop && !underDirector(env);
}

/** Ask live mode to look for the sandbox now (the arena's "Connect my agent app"). */
export function askForLive(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(LIVE_ASK_EVENT));
}
