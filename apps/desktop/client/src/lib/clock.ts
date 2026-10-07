// The one clock every countdown, rung and deadline in the client reads (useNow, nowUnix).
//
// In the desktop shell it is wall time and nothing can change that: the offset stays 0 because
// only the browser mock calls `simulateClock()`, and it refuses inside the shell. In a browser
// preview the mock turns the offset on so the scenario director can jump time ("four hours
// later") and every mock window, every countdown and the mock's own deadlines move together.

type Listener = () => void;

let offset = 0;
let simulated = false;
const listeners = new Set<Listener>();

const wallSeconds = () => Math.floor(Date.now() / 1000);

/** Unix seconds as the wallet sees them: wall time, plus the preview offset when simulated. */
export function clockNow(): number {
  return wallSeconds() + offset;
}

/** Seconds the preview clock runs ahead of wall time (always 0 in the shell). */
export function clockOffset(): number {
  return offset;
}

export function isClockSimulated(): boolean {
  return simulated;
}

/** Notified whenever the offset jumps (not on every wall-clock second). */
export function onClockChange(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function inShell(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Browser preview only: allow the offset to move. Returns false (and stays wall time) inside the
 * desktop shell, so a stray call there is a no-op passthrough.
 */
export function simulateClock(): boolean {
  if (inShell()) return false;
  simulated = true;
  return true;
}

/** Set the preview offset in whole seconds. Ignored unless `simulateClock()` turned it on. */
export function setClockOffset(seconds: number): void {
  if (!simulated || !Number.isFinite(seconds)) return;
  const next = Math.trunc(seconds);
  if (next === offset) return;
  offset = next;
  listeners.forEach((l) => l());
}

/** Tests only: back to plain wall time. */
export function resetClockForTests(): void {
  offset = 0;
  simulated = false;
  listeners.clear();
}
