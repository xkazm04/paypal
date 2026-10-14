// HoldGesture: the Calibre "press the seal" presenter (rebuild WP1a). For the APPROVAL window only.
// It never calls a command: a full, unbroken hold of `ms` calls `onComplete` exactly once, and the
// caller decides what that means. Pointer: hold the button. Keyboard: hold Space while it is
// focused. Enter, a click, a short press, leaving the button, losing focus or being disabled never
// complete it, so "Enter never releases money" holds by construction (as for HoldButton).
// Reduced motion / calm: the hold still takes the full time; the rosette fills in four steps
// instead of a continuous sweep and the release drain is instant.
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { HOLD_DRAIN_MS, HOLD_MS, useCalm } from '../../design/motion';
import { Rosette } from '../brand/Rosette';

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

export type HoldPhase = 'idle' | 'holding' | 'sealed';

export type HoldGestureProps = {
  /** The action, e.g. "Approve $64.00". */
  label: ReactNode;
  /** A small line under the label, e.g. "Press and hold, or hold Space". */
  sub?: ReactNode;
  /** Called once, when a hold reaches `ms`. Never on Enter, a click or a short press. */
  onComplete: () => void;
  /** Hold duration in milliseconds (default HOLD_MS, 1200). */
  ms?: number;
  disabled?: boolean;
  /** Screen-reader text read before the label, e.g. "Press and hold to approve". */
  hint: string;
  /** Accessible name of the progress gauge, e.g. "Hold progress". */
  progressLabel: string;
  /** Announced once while holding, e.g. "Keep holding". */
  holdingText: string;
  /** Announced once when the hold completes, e.g. "Confirmed". */
  doneText: string;
  className?: string;
  title?: string;
};

/** The phase word a screen reader hears: nothing, then `holding`, then `done` (never a percentage). */
export function holdPhaseWord(phase: HoldPhase, holding: string, done: string): string {
  return phase === 'sealed' ? done : phase === 'holding' ? holding : '';
}

/** The fill the rosette shows: continuous, or in quarter steps when motion is calm. */
export function shownProgress(p: number, calm: boolean): number {
  const v = Math.min(1, Math.max(0, p));
  return calm && v < 1 ? Math.floor(v * 4) / 4 : v;
}

export function HoldGesture({ label, sub, onComplete, ms = HOLD_MS, disabled, hint, progressLabel, holdingText, doneText, className, title }: HoldGestureProps) {
  const calm = useCalm();
  const [p, setP] = useState(0);
  const [phase, setPhase] = useState<HoldPhase>('idle');
  const raf = useRef<number | null>(null);
  const t0 = useRef(0);
  const holding = useRef(false);
  const fired = useRef(false);
  const progress = useRef(0);
  const done = useRef(onComplete);
  useEffect(() => { done.current = onComplete; }, [onComplete]);
  const pid = useId();

  const cancelFrame = () => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
  };
  const set = (v: number) => { progress.current = v; setP(v); };

  const tick = () => {
    if (!holding.current) return;
    const v = (performance.now() - t0.current) / ms;
    if (v >= 1) {
      holding.current = false; raf.current = null;
      set(1);
      if (!fired.current) { fired.current = true; setPhase('sealed'); done.current(); }
      return;
    }
    set(v);
    raf.current = requestAnimationFrame(tick);
  };

  const begin = () => {
    if (disabled || fired.current || holding.current) return;
    cancelFrame();
    holding.current = true;
    // Resume from what is still showing (a quick re-press during the drain), never from more.
    t0.current = performance.now() - progress.current * ms;
    setPhase('holding');
    raf.current = requestAnimationFrame(tick);
  };

  const release = () => {
    if (!holding.current) return;
    holding.current = false;
    cancelFrame();
    if (fired.current) return;
    setPhase('idle');
    if (calm) { set(0); return; }
    const from = progress.current, ts = performance.now();
    const drain = () => {
      if (holding.current || fired.current) return;
      const v = from - (performance.now() - ts) / HOLD_DRAIN_MS;
      set(Math.max(0, v));
      raf.current = v > 0 ? requestAnimationFrame(drain) : null;
    };
    raf.current = requestAnimationFrame(drain);
  };

  useEffect(() => () => cancelFrame(), []);
  // Disabling (a lock, or the decision running) cancels a half-finished hold and re-arms it, so after
  // a failed or refused decision it can be held again once it is enabled.
  useEffect(() => {
    if (!disabled) return;
    cancelFrame();
    holding.current = false; fired.current = false;
    set(0); setPhase('idle');
  }, [disabled]);

  const shown = shownProgress(p, calm);
  const style = { '--p': shown.toFixed(3) } as CSSProperties;
  return (
    <button type="button" className={cx('ui-hgest', className)} data-phase={phase} disabled={disabled} title={title} style={style}
      aria-describedby={pid}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.focus();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        begin();
      }}
      onPointerUp={release} onPointerCancel={release} onPointerLeave={release} onBlur={release}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); return; } // never on Enter
        if (e.key === ' ') { e.preventDefault(); if (!e.repeat) begin(); }
      }}
      onKeyUp={(e) => { if (e.key === ' ') { e.preventDefault(); release(); } }}
      onClick={(e) => e.preventDefault()}>
      <span className="sr-only">{hint}: </span>
      <span className="ui-hgest-ros" id={pid} role="progressbar" aria-label={progressLabel}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(shown * 100)}>
        <Rosette progress={shown} />
      </span>
      <span className="ui-hgest-l">
        <b>{label}</b>
        {sub ? <small>{sub}</small> : null}
      </span>
      <span className="sr-only" aria-live="polite">{holdPhaseWord(phase, holdingText, doneText)}</span>
    </button>
  );
}
