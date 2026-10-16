// The in-app calm motion toggle (the footer's switch): the seal stops turning and layers only
// crossfade, exactly as when the computer asks for reduced motion. Kept per viewer in localStorage
// (`table-calm`); design/motion.ts sets the class and tells its subscribers. Display only.
import { setCalm } from '../../../design/motion';

export const CALM_KEY = 'table-calm';

/** The stored choice (false when there is none or storage is blocked). */
export function readCalm(store: Pick<Storage, 'getItem'> | null = safeStore()): boolean {
  try { return store?.getItem(CALM_KEY) === '1'; } catch { return false; }
}

/** Turns calm motion on or off and remembers it. */
export function writeCalm(on: boolean, store: Pick<Storage, 'setItem' | 'removeItem'> | null = safeStore()): void {
  setCalm(on);
  try { if (on) store?.setItem(CALM_KEY, '1'); else store?.removeItem(CALM_KEY); } catch { /* storage blocked: the choice lasts this session */ }
}

/** Applies the stored choice before the first paint (entry.tsx). */
export function initCalm(): void {
  if (readCalm()) setCalm(true);
}

/** True when the in-app toggle is on (the OS setting is separate and wins either way). */
export function calmToggled(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('calm');
}

function safeStore(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
