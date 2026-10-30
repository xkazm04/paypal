// The Rewind's clock (moved from Rewind.tsx by rebuild WP3c): which week, where the playhead is, and
// play / pause, over the week's verified record (deal_history). Read-only: nothing here can move
// money or change a deal. With reduced motion, play steps from one tick to the next instead of
// gliding; a full week plays in PLAY_SECONDS. The current week runs on past "now" into the forecast's
// 72 hours (the walk-away forecast, future.ts): the playhead may go there, play pauses a moment at
// the gold now line, and a past week ends where it always did.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HistoryStep } from '@bindings/HistoryStep';
import type { WalletError } from '../../../../../lib/contract';
import { useQuery } from '../../../../../lib/hooks';
import { laneSteps, weekBounds } from '../../../logic';
import { useEndedUnshown } from '../../../unshown';
import { HORIZON_SECS } from './future';

const WEEK = 7 * 86400;
/** Play stays this long on the gold now line before it goes on into the forecast. */
export const NOW_HOLD_MS = 1100;
/** A full week plays in this many seconds. */
export const PLAY_SECONDS = 16;
/** With reduced motion, play steps from one tick to the next at this pace instead of gliding. */
export const STEP_MS = 1100;

export type RewindState = {
  start: number;
  end: number;
  /** The playhead, Unix seconds. */
  t: number;
  /** The latest moment the playhead may reach: 72 hours past now (the forecast's reach) in the current week, the week's end in a past one. */
  limit: number;
  /** The wallet's now, Unix seconds: the gold line. In a past week it is the week's end, so the line is off the right edge. */
  now: number;
  /** The track's right edge: the week's end, or `limit` when that is later. */
  stop: number;
  /** The week holds the present: the track has a future side. */
  ahead: boolean;
  steps: HistoryStep[];
  /** The week had more steps than one read returns, so the oldest are not here. */
  truncated: boolean;
  /** Deals whose own record shows they ended while a money step was open, for endings whose check began before this week's steps. */
  unshown: ReadonlySet<string>;
  /** Deals that ended at the deadline whose own record could not be read: whether money moved is not known yet. */
  unread: ReadonlySet<string>;
  loading: boolean;
  error: WalletError | null;
  playing: boolean;
  weekBack: number;
  seek: (t: number) => void;
  /** Glide the playhead to a moment over `ms` (a jump with reduced motion); any seek, play or pause of the owner's cancels it. */
  glide: (to: number, ms?: number) => void;
  play: () => void;
  pause: () => void;
  shiftWeek: (d: 1 | -1) => void;
};

/** `stops`: the moments of the forecast's steps, so reduced-motion play and the keys can stop on them too. */
export function useRewind(on: boolean, now: number, reduced: boolean, stops: readonly number[] = []): RewindState {
  const [weekBack, setWeekBack] = useState(0);
  const { start, end } = weekBounds(now - weekBack * WEEK);
  const ahead = weekBack === 0;
  const limit = ahead ? now + HORIZON_SECS : end;
  const stop = Math.max(end, limit);
  const live0 = Math.min(now, end);
  const q = useQuery('deal_history', { deal_id: null, from: start, to: end }, { enabled: on, refreshOn: ['deal:changed'] });
  const steps = useMemo(() => q.data?.steps ?? [], [q.data]);
  const { unshown, unread, pending } = useEndedUnshown(steps, on);
  const [t, setT] = useState(live0);
  const [playing, setPlaying] = useState(false);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const live = useRef({ t, limit, start, steps, now, end, stops });
  live.current = { t, limit, start, steps, now, end, stops };
  /** When play paused on the now line (performance.now ms): play holds there, once per pass. */
  const hold = useRef<{ until: number; passed: boolean }>({ until: 0, passed: false });

  // Entering Rewind (or changing week) puts the playhead at the latest moment of that week (now, in
  // this one); the clock's own ticking does not move it.
  useEffect(() => {
    if (!on) return;
    setT(Math.min(live.current.now, live.current.end));
    setPlaying(false);
  }, [on, weekBack]);

  const gliding = useRef(0);
  const stopGlide = () => { if (gliding.current) cancelAnimationFrame(gliding.current); gliding.current = 0; };
  const clamp = (x: number) => Math.round(Math.min(live.current.limit, Math.max(live.current.start, x)));
  const seek = useCallback((x: number) => { stopGlide(); setT(clamp(x)); }, []);
  const pause = useCallback(() => { stopGlide(); setPlaying(false); }, []);
  const glide = useCallback((to: number, ms = 1800) => {
    stopGlide();
    setPlaying(false);
    const from = live.current.t;
    const goal = clamp(to);
    if (reducedRef.current || ms <= 0 || goal === from) { setT(goal); return; }
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      setT(Math.round(from + (goal - from) * (1 - (1 - k) ** 3)));
      gliding.current = k < 1 ? requestAnimationFrame(step) : 0;
    };
    gliding.current = requestAnimationFrame(step);
  }, []);
  useEffect(() => stopGlide, []);
  const play = useCallback(() => {
    stopGlide();
    // From the end, play starts again at Monday.
    const restart = live.current.t >= live.current.limit - 60;
    if (restart) setT(live.current.start);
    hold.current = { until: 0, passed: !restart && live.current.t >= live.current.now };
    setPlaying(true);
  }, []);
  const shiftWeek = useCallback((d: 1 | -1) => setWeekBack((w) => Math.max(0, w - d)), []);

  useEffect(() => {
    if (!on || !playing) return;
    if (reduced) {
      // Jump from tick to tick: no gliding motion.
      const timer = setInterval(() => {
        const { t: cur, limit: lim, steps: all, stops: fut, now: nowAt } = live.current;
        const next = [...laneSteps(all).map((s) => s.at), ...fut, nowAt].filter((at) => at > cur).sort((a, b) => a - b)[0];
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
      const { t: cur, limit: lim, now: nowAt } = live.current;
      if (ms < hold.current.until) { raf = requestAnimationFrame(frame); return; }
      let next = Math.min(lim, cur + dt * rate);
      // Crossing the gold now line: stop on it for a moment, then go on into what is forecast.
      if (!hold.current.passed && cur < nowAt && next >= nowAt && nowAt < lim) {
        next = nowAt;
        hold.current = { until: ms + NOW_HOLD_MS, passed: true };
      }
      live.current.t = next;
      // Re-render about 24 times a second; the motion is the playhead and the hub changing.
      if (ms - shown > 40 || next >= lim) { shown = ms; setT(next); }
      if (next >= lim) { setPlaying(false); return; }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [on, playing, reduced]);

  return { start, end, t: Math.min(t, limit), limit, now: ahead ? now : end, stop, ahead, steps, truncated: q.data?.truncated ?? false, unshown, unread, loading: (q.loading && !q.data) || pending, error: q.error, playing, weekBack, seek, glide, play, pause, shiftWeek };
}
