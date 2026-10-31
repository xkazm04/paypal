// BROWSER PREVIEW ONLY. Picking up a card with the pointer: it follows the pointer, tilts with the
// motion, lands when released over the table, and springs back to its place anywhere else. A press
// that never moved is a click (the card plays). Keyboard play stays on the button itself.
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/** How far the pointer moves before a press becomes a drag. */
export const DRAG_SLOP = 6;
export const BOUNCE_MS = 380;

export type Held = {
  id: string;
  /** Where the card sat when it was picked up (viewport pixels). */
  home: { x: number; y: number; w: number; h: number };
  /** The pointer's offset inside the card. */
  grab: { x: number; y: number };
  x: number;
  y: number;
  /** Degrees, from the last horizontal motion. */
  tilt: number;
  over: boolean;
  /** Released away from the table: on its way home. */
  returning: boolean;
};

/** The tilt for a horizontal step (clamped). */
export const tiltFor = (dx: number): number => Math.max(-12, Math.min(12, dx * 0.6));

/** Is the point inside the rectangle? */
export const inside = (r: { left: number; top: number; right: number; bottom: number } | null | undefined, x: number, y: number): boolean =>
  !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

export function useCardDrag(target: () => DOMRect | null, onDrop: (id: string) => void, reduced: boolean) {
  const [held, setHeld] = useState<Held | null>(null);
  const press = useRef<{ id: string; x: number; y: number; el: HTMLElement; pointer: number } | null>(null);
  const moved = useRef(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);

  const down = useCallback((id: string, e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || e.pointerType === 'touch' && !e.isPrimary) return;
    press.current = { id, x: e.clientX, y: e.clientY, el: e.currentTarget, pointer: e.pointerId };
    moved.current = false;
  }, []);

  const move = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const p = press.current;
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!moved.current) {
      if (Math.hypot(dx, dy) < DRAG_SLOP) return;
      moved.current = true;
      try { p.el.setPointerCapture(p.pointer); } catch { /* the pointer already left */ }
      const r = p.el.getBoundingClientRect();
      setHeld({ id: p.id, home: { x: r.left, y: r.top, w: r.width, h: r.height }, grab: { x: p.x - r.left, y: p.y - r.top }, x: r.left, y: r.top, tilt: 0, over: false, returning: false });
    }
    setHeld((h) => h && !h.returning ? {
      ...h, x: e.clientX - h.grab.x, y: e.clientY - h.grab.y,
      tilt: reduced ? 0 : tiltFor(e.movementX || 0) * 0.5 + h.tilt * 0.5,
      over: inside(target(), e.clientX, e.clientY),
    } : h);
  }, [reduced, target]);

  const up = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const p = press.current;
    press.current = null;
    if (!p || !moved.current) return;
    const dropped = inside(target(), e.clientX, e.clientY);
    if (dropped) {
      setHeld(null);
      onDrop(p.id);
      return;
    }
    if (reduced) { setHeld(null); return; }
    setHeld((h) => h ? { ...h, returning: true, x: h.home.x, y: h.home.y, tilt: 0, over: false } : h);
    timer.current = window.setTimeout(() => { timer.current = null; setHeld(null); }, BOUNCE_MS);
  }, [onDrop, reduced, target]);

  /** A press that turned into a drag must not also play the card as a click. */
  const wasDrag = useCallback(() => {
    const d = moved.current;
    moved.current = false;
    return d;
  }, []);

  const cancel = useCallback(() => { press.current = null; moved.current = false; setHeld(null); }, []);

  return { held, down, move, up, wasDrag, cancel };
}
