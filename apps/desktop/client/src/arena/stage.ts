// stage.ts - BROWSER PREVIEW ONLY. What the director stages in Break The Table: which recorded attacks
// have landed, in order, and whether the closing card is open. The director's `try` story writes it
// (director/actions.ts `{ do: 'arena' }`), the framed console's place "Try to break it" follows it.
//
// Same mechanism as the Say it sentence (lib/say/store.ts): the director page and its frames share the
// browser's storage, a write in one is a `storage` event in the others. A beat never clicks a card: it
// says what the viewer would have played, and the arena lands those recorded answers itself, exactly as a
// click would (record.ts; nothing it reaches moves money). Only a page under the director follows it
// (lib/preview.ts underDirector): a person's own arena never replays what a story left behind.
import { useSyncExternalStore } from 'react';

export type ArenaStage = {
  /** Recorded attack ids, in the order they land (record.ts). */
  played: readonly string[];
  /** The closing card ("Check the proof yourself") is open. */
  finale: boolean;
};

const KEY = 'table.arena.stage';

/** The stored stage, or null: nothing staged. */
export function parseArenaStage(raw: string | null): ArenaStage | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { played?: unknown; finale?: unknown };
    const played = Array.isArray(v.played) ? v.played.filter((x): x is string => typeof x === 'string').slice(0, 32) : [];
    return { played, finale: v.finale === true };
  } catch {
    return null;
  }
}

function read(): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** The director's write: what the arena shows now (null or nothing played and no finale: nothing staged). */
export function setArenaStage(s: ArenaStage | null): void {
  try {
    if (!s || (s.played.length === 0 && !s.finale)) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify({ played: [...s.played], finale: s.finale }));
  } catch { /* no storage: the frame keeps what it shows */ }
  listeners.forEach((l) => l());
}

const listeners = new Set<() => void>();
function subscribe(l: () => void): () => void {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => { if (e.key === KEY || e.key === null) l(); };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(l); window.removeEventListener('storage', onStorage); };
}
const none = (): null => null;
const noop = (): (() => void) => () => undefined;

/** The raw staged value while `follow` (a page under the director), else null. Compare it as a string;
 *  `parseArenaStage` reads it. */
export function useArenaStage(follow: boolean): string | null {
  return useSyncExternalStore(follow ? subscribe : noop, follow ? read : none, none);
}
