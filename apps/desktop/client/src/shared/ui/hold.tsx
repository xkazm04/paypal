// Hold to confirm (docs/ux/ROUND-2.md; approved and permanent). For actions that release or pay money:
// press and hold for `ms` while a ring fills, then `onConfirm` runs once. Releasing early cancels.
// Pointer: hold the button. Keyboard: hold Space while it is focused. Enter never runs it, so the
// approval window's "Enter never releases money" rule holds by construction.
import { useEffect, useRef, useState, type ReactNode } from 'react';

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

export type HoldButtonProps = {
  children: ReactNode;
  onConfirm: () => void;
  /** Hold duration in milliseconds. */
  ms?: number;
  disabled?: boolean;
  /** Visual kind, matching Btn: gold is the money action. */
  kind?: 'gold' | 'primary' | 'danger';
  title?: string;
  className?: string;
  /** Read by screen readers before the label, e.g. "Hold to approve". */
  hint?: string;
};

/** What a screen reader hears while holding: nothing, then "Keep holding", then "Confirmed". */
export function holdWord(done: boolean, progress: number): string {
  return done ? 'Confirmed' : progress > 0 ? 'Keep holding' : '';
}

export function HoldButton({ children, onConfirm, ms = 1200, disabled, kind = 'gold', title, className, hint = 'Press and hold to confirm' }: HoldButtonProps) {
  const [p, setP] = useState(0);
  const [done, setDone] = useState(false);
  const raf = useRef<number | null>(null);
  const start = useRef<number | null>(null);
  const fired = useRef(false);

  const stop = () => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null; start.current = null;
    if (!fired.current) setP(0);
  };
  const tick = (t: number) => {
    if (start.current === null) start.current = t;
    const v = Math.min(1, (t - start.current) / ms);
    setP(v);
    if (v >= 1) {
      raf.current = null; start.current = null;
      if (!fired.current) { fired.current = true; setDone(true); onConfirm(); }
      return;
    }
    raf.current = requestAnimationFrame(tick);
  };
  const begin = () => {
    if (disabled || fired.current || raf.current !== null) return;
    raf.current = requestAnimationFrame(tick);
  };
  useEffect(() => () => { if (raf.current !== null) cancelAnimationFrame(raf.current); }, []);
  // Disabling (a lock, or the decision running) cancels a half-finished hold and re-arms the button,
  // so after a failed or refused decision it can be held again once it is enabled.
  useEffect(() => {
    if (!disabled) return;
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null; start.current = null; fired.current = false;
    setDone(false); setP(0);
  }, [disabled]);

  const R = 9, C = 2 * Math.PI * R;
  return (
    <button type="button" className={cx('ui-btn', 'ui-hold', kind, done && 'done', p > 0 && !done && 'holding', className)} disabled={disabled} title={title}

      onPointerDown={(e) => { if (e.button === 0) { (e.currentTarget as HTMLButtonElement).setPointerCapture?.(e.pointerId); begin(); } }}
      onPointerUp={stop} onPointerCancel={stop} onPointerLeave={stop}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); return; } // never on Enter
        if (e.key === ' ' && !e.repeat) { e.preventDefault(); begin(); }
      }}
      onKeyUp={(e) => { if (e.key === ' ') { e.preventDefault(); stop(); } }}
      onClick={(e) => e.preventDefault()}>
      <span className="sr-only">{hint}: </span>
      <svg className="ring" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
        <circle cx="11" cy="11" r={R} fill="none" stroke="currentColor" strokeOpacity=".25" strokeWidth="2.4" />
        <circle cx="11" cy="11" r={R} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - p)} transform="rotate(-90 11 11)" />
        {done ? <path d="M7 11.2l2.6 2.6L15 8.4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /> : null}
      </svg>
      <span className="lbl">{children}</span>
      {/* One word per phase, never a running percentage (that would be read out every frame). */}
      <span className="sr-only" aria-live="polite">{holdWord(done, p)}</span>
    </button>
  );
}
