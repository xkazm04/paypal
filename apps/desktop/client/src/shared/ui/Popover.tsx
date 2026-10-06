// Layer 2 · Popover: a small anchored panel (ui.css .ui-popover). Closes on an outside click or
// Esc (topmost layer only). Positioned below the anchor, flipped above when there is no room;
// left/top are set through CSSOM (React style), which the CSP allows.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLayer } from './layers';

export type PopoverProps = {
  /** The element the popover hangs from (usually the button that opened it). */
  anchor: HTMLElement;
  onClose: () => void;
  title?: ReactNode;
  className?: string;
  children?: ReactNode;
};

export function place(anchor: DOMRect, w: number, h: number, vw: number, vh: number): { left: number; top: number } {
  const left = Math.min(Math.max(8, anchor.left + anchor.width / 2 - w / 2), Math.max(8, vw - w - 8));
  let top = anchor.bottom + 6;
  if (top + h > vh - 8) top = Math.max(8, anchor.top - h - 6);
  return { left, top };
}

export function Popover({ anchor, onClose, title, className, children }: PopoverProps) {
  const el = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayer(onClose, 'popover');

  useLayoutEffect(() => {
    const measure = () => {
      const box = el.current;
      if (!box) return;
      setPos(place(anchor.getBoundingClientRect(), box.offsetWidth, box.offsetHeight, window.innerWidth, window.innerHeight));
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [anchor]);

  // Outside click closes; a click on the anchor is left to the anchor (it usually toggles).
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const out = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t || el.current?.contains(t) || anchor.contains(t)) return;
      close.current();
    };
    document.addEventListener('pointerdown', out, true);
    return () => document.removeEventListener('pointerdown', out, true);
  }, [anchor]);

  // Focus the panel for keyboard and screen-reader users; hand focus back to the anchor only if
  // it was still inside the popover (an outside click keeps focus where the user put it).
  useEffect(() => {
    const box = el.current;
    box?.focus({ preventScroll: true });
    return () => {
      if (box && box.contains(document.activeElement) && anchor.isConnected) anchor.focus({ preventScroll: true });
    };
  }, [anchor]);

  return createPortal(
    <div ref={el} className={`ui-popover ${className ?? ''}`} role="dialog" aria-label={typeof title === 'string' ? title : undefined} tabIndex={-1}
      style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}>
      {title ? <h3>{title}</h3> : null}
      {children}
    </div>,
    document.body,
  );
}
