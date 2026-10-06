// The layer stack: every open Layer-2 surface (sheet, popover, inspector with a close, confirm,
// palette) registers here, and Esc closes the TOPMOST layer only.
//
// One keydown listener on `window` in the CAPTURE phase handles Esc while the stack is non-empty:
// it closes the top layer and stops the event, so nothing else sees that Esc - in particular the
// main window's "Esc goes back one level" handler (windows/main/App.tsx, bubble phase on window)
// and Home's key handler only run when no layer is open. With an empty stack the listener does
// nothing and Esc reaches the page as before.
//
// Closing pops the entry first and then calls its close(), so two quick Escs close two layers even
// before React re-renders; the owner's cleanup is then a no-op.
import { useEffect, useRef, useSyncExternalStore } from 'react';

export type LayerKind = 'sheet' | 'popover' | 'inspector' | 'confirm' | 'palette' | 'other';

type Entry = { id: number; kind: LayerKind; close: () => void };

const stack: Entry[] = [];
const subs = new Set<() => void>();
let seq = 0;
let installed = false;

function notify(): void {
  for (const s of subs) s();
}

/** Register an open layer. Returns the function that removes it (call it on unmount). */
export function pushLayer(close: () => void, kind: LayerKind = 'other'): () => void {
  install();
  const e: Entry = { id: ++seq, kind, close };
  stack.push(e);
  notify();
  return () => {
    const i = stack.indexOf(e);
    if (i >= 0) {
      stack.splice(i, 1);
      notify();
    }
  };
}

/** Close the topmost layer. Returns false when no layer is open. */
export function closeTopLayer(): boolean {
  const top = stack.pop();
  if (!top) return false;
  notify();
  top.close();
  return true;
}

export function layerCount(): number {
  return stack.length;
}

export function topLayerKind(): LayerKind | null {
  return stack[stack.length - 1]?.kind ?? null;
}

/** The keydown rule, exported for tests: Esc with an open layer closes the top one and is consumed. */
export function handleLayerKeydown(e: KeyboardEvent): boolean {
  if (e.key !== 'Escape' || e.isComposing || !stack.length) return false;
  e.preventDefault();
  e.stopImmediatePropagation();
  closeTopLayer();
  return true;
}

function install(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('keydown', handleLayerKeydown, true);
}

/** Test-only: forget every layer (does not call their close). */
export function resetLayersForTest(): void {
  stack.splice(0, stack.length);
  notify();
}

function subscribe(fn: () => void): () => void {
  subs.add(fn);
  return () => { subs.delete(fn); };
}

/** Number of open layers, re-rendering on change. Use it to pause page keys (arrows, Enter, 1-6). */
export function useLayerCount(): number {
  return useSyncExternalStore(subscribe, layerCount, layerCount);
}

/**
 * Register the calling component as a layer while `active`. The latest `onClose` is always used,
 * and the registration (its place in the stack) does not change when `onClose` changes identity.
 * Note: effects run child-first, so open a nested layer after its parent (e.g. on a click).
 */
export function useLayer(onClose: () => void, kind: LayerKind = 'other', active = true): void {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    if (!active) return;
    return pushLayer(() => ref.current(), kind);
  }, [active, kind]);
}
