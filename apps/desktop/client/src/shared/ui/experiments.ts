// Round-2 UX experiments still on trial (docs/ux/ROUND-2.md); the approved ones are permanent code. Each is
// on by default and can be switched off per machine from the main window's ? sheet; with a switch off the
// screen renders as round 1 did.
// Stored in localStorage, so the main and approval windows (same origin) read the same setting.
// Display only: no experiment changes what moves money or who may move it.
import { useEffect, useState } from 'react';

export const EXPERIMENTS = [
  { key: 'r2-book', name: 'Where the money went', where: 'Book', what: 'Bars by kind, a PayPal-agrees meter and question chips.' },
] as const;
export type ExperimentKey = (typeof EXPERIMENTS)[number]['key'];

const KEY = (k: ExperimentKey) => `table-exp-${k}`;
const EVENT = 'table-experiments';

export function experimentOn(k: ExperimentKey): boolean {
  try { return typeof localStorage === 'undefined' || localStorage.getItem(KEY(k)) !== 'off'; } catch { return true; }
}

export function setExperiment(k: ExperimentKey, on: boolean): void {
  try { localStorage.setItem(KEY(k), on ? 'on' : 'off'); } catch { /* per-machine convenience only */ }
  window.dispatchEvent(new Event(EVENT));
}

/** Whether a round-2 experiment is on; re-renders when it is switched here or in another window. */
export function useExperiment(k: ExperimentKey): boolean {
  const [on, setOn] = useState(() => experimentOn(k));
  useEffect(() => {
    const sync = () => setOn(experimentOn(k));
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener('storage', sync); };
  }, [k]);
  return on;
}
