// Focus helpers for Layer-2 surfaces: remember where focus was, give it back on close, keep Tab
// inside a modal, pull focus back when it escapes behind a modal, and rescue focus that a
// re-render dropped on the page body (a decided money button disappears, a row is removed).
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

// ---- modal focus guard ------------------------------------------------------------------------
// Open modals (Sheet, the Find palette) register here, innermost last. One document `focusin`
// listener moves focus that lands outside the topmost modal back to it: a Tab from the page body
// (after a click on plain text in the sheet, say) can then never walk the page behind the scrim.
// Floating layers that belong to a modal but render elsewhere (popovers, toasts, tooltips) carry
// `data-layer-free` and are left alone.

type Modal = { box: () => HTMLElement | null; home: () => HTMLElement | null };
const modals: Modal[] = [];
let guarding = false;

/** Where focus belongs when it lands at `target`; null when it may stay. Exported for tests. */
export function modalFocusTarget(target: EventTarget | null): HTMLElement | null {
  const top = modals[modals.length - 1];
  const box = top?.box();
  if (!top || !box || !box.isConnected) return null;
  if (!(target instanceof Node) || box.contains(target)) return null;
  if (target instanceof Element && target.closest('[data-layer-free]')) return null;
  return top.home() ?? box;
}

function onFocusIn(e: FocusEvent): void {
  const to = modalFocusTarget(e.target);
  if (to && to !== e.target) to.focus({ preventScroll: true });
}

/**
 * Keep focus inside `box` while mounted (and `active`): focus that escapes goes to `home` (the
 * sheet's heading, never a button) or to the box itself. The box should carry tabIndex={-1}, so a
 * click on its plain text keeps focus inside instead of dropping it on the page body.
 */
export function useModalFocus(box: RefObject<HTMLElement | null>, home?: RefObject<HTMLElement | null>, active = true): void {
  useEffect(() => {
    if (!active || typeof document === 'undefined') return;
    const m: Modal = { box: () => box.current, home: () => home?.current ?? null };
    modals.push(m);
    if (!guarding) { document.addEventListener('focusin', onFocusIn); guarding = true; }
    return () => {
      const i = modals.indexOf(m);
      if (i >= 0) modals.splice(i, 1);
      if (!modals.length && guarding) { document.removeEventListener('focusin', onFocusIn); guarding = false; }
    };
  }, [box, home, active]);
}

// ---- focus rescue -------------------------------------------------------------------------------

/** True when keyboard focus has been lost to the page (nothing, or the body, is focused). */
export function focusLost(doc: Document = document): boolean {
  const a = doc.activeElement;
  return !a || a === doc.body || a === doc.documentElement;
}

/**
 * After every render: if focus was inside `scope` (or anywhere, without a scope) and the focused
 * element went away (a decided button unmounts, a list shrinks), put focus on `fallback` - a
 * heading or a status line with tabIndex={-1}, never a button. Mouse users see no ring
 * (:focus-visible), keyboard and screen-reader users keep their place.
 */
export function useFocusRescue(fallback: RefObject<HTMLElement | null>, scope?: RefObject<HTMLElement | null>): void {
  const last = useRef<Element | null>(null);
  useEffect(() => {
    const on = (e: FocusEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      const root = scope?.current;
      last.current = t && (!root || root.contains(t)) ? t : null;
    };
    document.addEventListener('focusin', on);
    return () => document.removeEventListener('focusin', on);
  }, [scope]);
  useEffect(() => {
    if (shouldRescue(last.current)) {
      last.current = null;
      const el = fallback.current;
      if (el && el.isConnected) el.focus({ preventScroll: true });
    }
  });
}

/** Rescue only when the element that had focus is gone; a click on plain page text is left alone. */
export function shouldRescue(lastFocused: Element | null, doc: Document = document): boolean {
  return !!lastFocused && !lastFocused.isConnected && focusLost(doc);
}
