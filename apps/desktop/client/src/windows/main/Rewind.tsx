// The Dial's Rewind: the week replayed from the wallet's own verified record (deal_history). A
// Mon-Sun scrubber sits under the dial; beads stand where their deals stood at the playhead, and a
// lane of ticks marks every PayPal money call, coloured by who decided it (you = gold, a rule you
// signed = teal, the buyer's approval under your shop rules = green, the safe default = grey). A
// refusal is an × with no PayPal call. Read-only: nothing here can move money or change a deal.
// This file is the clock (useRewind) and the tick mark; the scrubber and hub are RewindParts.tsx.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HistoryStep } from '@bindings/HistoryStep';
import type { WalletError } from '../../lib/contract';
import { useQuery } from '../../lib/hooks';
import './rewind.css';
import { laneSteps, weekBounds, type TickTone } from './logic';
import { useEndedUnshown } from './unshown';

const WEEK = 7 * 86400;
/** A full week plays in this many seconds. */
const PLAY_SECONDS = 16;
/** With reduced motion, play steps from one tick to the next at this pace instead of gliding. */
const STEP_MS = 1100;

export type RewindState = {
  start: number;
  end: number;
  /** The playhead, Unix seconds. */
  t: number;
  /** The latest moment the playhead may reach: now, or the week's end for a past week. */
  limit: number;
  steps: HistoryStep[];
  /** Deals whose own record shows they ended while a money step was open, for endings whose check began before this week's steps. */
  unshown: ReadonlySet<string>;
  /** Deals that ended at the deadline whose own record could not be read: whether money moved is not known yet. */
  unread: ReadonlySet<string>;
  loading: boolean;
  error: WalletError | null;
  playing: boolean;
  weekBack: number;
  seek: (t: number) => void;
  play: () => void;
  pause: () => void;
  shiftWeek: (d: 1 | -1) => void;
};

/** The Rewind's clock: which week, where the playhead is, and play / pause. */
export function useRewind(on: boolean, now: number, reduced: boolean): RewindState {
  const [weekBack, setWeekBack] = useState(0);
  const { start, end } = weekBounds(now - weekBack * WEEK);
  const limit = Math.min(now, end);
  const q = useQuery('deal_history', { deal_id: null, from: start, to: end }, { enabled: on, refreshOn: ['deal:changed'] });
  const steps = useMemo(() => q.data?.steps ?? [], [q.data]);
  const { unshown, unread, pending } = useEndedUnshown(steps, on);
  const [t, setT] = useState(limit);
  const [playing, setPlaying] = useState(false);
  const live = useRef({ t, limit, start, steps });
  live.current = { t, limit, start, steps };

  // Entering Rewind (or changing week) puts the playhead at the latest moment of that week.
  useEffect(() => { if (on) { setT(Math.min(now, end)); setPlaying(false); } }, [on, weekBack]); // eslint-disable-line react-hooks/exhaustive-deps

  const seek = useCallback((x: number) => { setT(Math.round(Math.min(live.current.limit, Math.max(live.current.start, x)))); }, []);
  const pause = useCallback(() => setPlaying(false), []);
  const play = useCallback(() => {
    // From the end, play starts again at Monday.
    if (live.current.t >= live.current.limit - 60) setT(live.current.start);
    setPlaying(true);
  }, []);
  const shiftWeek = useCallback((d: 1 | -1) => setWeekBack((w) => Math.max(0, w - d)), []);

  useEffect(() => {
    if (!on || !playing) return;
    if (reduced) {
      // Jump from tick to tick: no gliding motion.
      const timer = setInterval(() => {
        const { t: cur, limit: lim, steps: all } = live.current;
        const next = laneSteps(all).map((s) => s.at).filter((at) => at > cur).sort((a, b) => a - b)[0];
        if (next === undefined || next > lim) { setT(lim); setPlaying(false); return; }
        setT(next);
      }, STEP_MS);
      return () => clearInterval(timer);
    }
    let raf = 0;
    let last = performance.now();
    let shown = performance.now();
    const rate = WEEK / PLAY_SECONDS;
    const frame = (ms: number) => {
      const dt = Math.min(0.1, (ms - last) / 1000);
      last = ms;
      const { t: cur, limit: lim } = live.current;
      const next = Math.min(lim, cur + dt * rate);
      live.current.t = next;
      // Re-render about 24 times a second; the motion is the beads changing state.
      if (ms - shown > 40 || next >= lim) { shown = ms; setT(next); }
      if (next >= lim) { setPlaying(false); return; }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [on, playing, reduced]);

  return { start, end, t: Math.min(t, limit), limit, steps, unshown, unread, loading: (q.loading && !q.data) || pending, error: q.error, playing, weekBack, seek, play, pause, shiftWeek };
}

/** One tick's mark: a bar coloured by authority, or an × for a refusal. */
export function TickMark({ tone }: { tone: TickTone }) {
  return <i className={`rw-mark t-${tone}`} aria-hidden="true">{tone === 'refused' ? '×' : null}</i>;
}
