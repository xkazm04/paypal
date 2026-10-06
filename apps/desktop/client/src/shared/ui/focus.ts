// Focus helpers for Layer-2 surfaces: remember where focus was, give it back on close, and keep
// Tab inside a modal sheet.
import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Remember the focused element at mount; give focus back to it on unmount (if still in the page). */
export function useReturnFocus(): void {
  const back = useRef<HTMLElement | null>(null);
  useEffect(() => {
    back.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      const el = back.current;
      if (el && el.isConnected) el.focus({ preventScroll: true });
    };
  }, []);
}

/** Focus `ref` once at mount (never a button: Enter must not release money). */
export function useFocusOnMount(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => { ref.current?.focus({ preventScroll: true }); }, [ref]);
}

/** Tab / Shift+Tab wrap inside `container`. Call from the container's onKeyDown. */
export function trapTab(e: { key: string; shiftKey: boolean; preventDefault: () => void }, container: HTMLElement | null): void {
  if (e.key !== 'Tab' || !container) return;
  const items = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true');
  if (!items.length) { e.preventDefault(); return; }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || !container.contains(active))) { e.preventDefault(); last?.focus(); }
  else if (!e.shiftKey && (active === last || !container.contains(active))) { e.preventDefault(); first?.focus(); }
}
