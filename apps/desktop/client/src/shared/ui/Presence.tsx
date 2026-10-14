// Presence: keeps its children mounted while they animate out. `show` true mounts them with
// data-state="open" (kit.css animates the entrance); `show` false sets data-state="closing" and
// unmounts after `exitMs`. Calm motion (reduced motion or the calm class) unmounts at once. Display
// only: nothing waits on the exit, so no decision is ever delayed by an animation.
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { DUR, useCalm } from '../../design/motion';

export type PresenceProps = {
  show: boolean;
  children: ReactNode;
  /** How long the exit plays, in ms (default DUR.med, matching --dur-med). */
  exitMs?: number;
  /** 'rise' (sheets from below), 'drop' (from above) or 'fade'. */
  motion?: 'rise' | 'drop' | 'fade';
  className?: string;
};

export function Presence({ show, children, exitMs = DUR.med, motion = 'fade', className }: PresenceProps) {
  const calm = useCalm();
  const [mounted, setMounted] = useState(show);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (show) { setMounted(true); setClosing(false); return; }
    if (!mounted) return;
    if (calm || exitMs <= 0) { setMounted(false); setClosing(false); return; }
    setClosing(true);
    const t = setTimeout(() => { setMounted(false); setClosing(false); }, exitMs);
    return () => clearTimeout(t);
  }, [show, calm, exitMs, mounted]);

  if (!mounted) return null;
  return (
    <div className={`ui-presence${className ? ` ${className}` : ''}`} data-state={closing ? 'closing' : 'open'} data-motion={motion}
      style={{ '--presence-ms': `${exitMs}ms` } as CSSProperties} inert={closing ? true : undefined}>
      {children}
    </div>
  );
}
