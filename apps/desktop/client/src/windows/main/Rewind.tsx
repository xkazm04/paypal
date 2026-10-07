// The Dial's Rewind: the week replayed from the wallet's own verified record (deal_history). A
// Mon-Sun scrubber sits under the dial; beads stand where their deals stood at the playhead, and a
// lane of ticks marks every PayPal money call, coloured by who decided it (you = gold, a rule you
// signed = teal, the buyer's approval under your shop rules = green, the safe default = grey). A
// refusal is an × with no PayPal call. Read-only: nothing here can move money or change a deal.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react';
import type { Deal } from '@bindings/Deal';
import type { HistoryStep } from '@bindings/HistoryStep';
import type { WalletError } from '../../lib/contract';
import { useQuery } from '../../lib/hooks';
import { WalletNotice } from '../../shared/honesty';
import { weekLabel } from './home/model';
import './rewind.css';
import { isRefusal, laneSteps, narrate, stepTime, stepUnder, TICK_WORD, tickTone, weekBounds, weekFraction, type TickTone } from './logic';

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

  return { start, end, t: Math.min(t, limit), limit, steps, loading: q.loading && !q.data, error: q.error, playing, weekBack, seek, play, pause, shiftWeek };
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const LEGEND: readonly TickTone[] = ['owner', 'rule', 'buyer', 'default', 'refused'];
const LEGEND_SHORT: Record<TickTone, string> = { owner: 'You', rule: 'Your rule', buyer: 'Buyer approved', default: 'Safe default', refused: 'Refused', unknown: 'Not recorded' };

/** One tick's mark: a bar coloured by authority, or an × for a refusal. */
export function TickMark({ tone }: { tone: TickTone }) {
  return <i className={`rw-mark t-${tone}`} aria-hidden="true">{tone === 'refused' ? '×' : null}</i>;
}

type Labeller = (dealId: string) => { deal: Deal; label: string; title: string } | null;

/** The scrubber under the dial: play, the week, the PayPal lane, the playhead and the legend. */
export function RewindBar({ r, labelOf, onOpenDeal, onExit }: { r: RewindState; labelOf: Labeller; onOpenDeal: (id: string) => void; onExit: () => void }) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef(false);
  // The footer's Rewind entry leaves while rewinding, so keyboard focus lands on Play instead of
  // falling back to the page (Space then plays, as the ? sheet says).
  const playBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const a = document.activeElement;
    if (!a || a === document.body) playBtn.current?.focus({ preventScroll: true });
  }, []);
  const ticks = useMemo(() => {
    const lane = laneSteps(r.steps).filter((s) => labelOf(s.deal_id));
    // Ticks within ~1% of the week (a couple of hours) sit side by side, centred on the first.
    const clusters: HistoryStep[][] = [];
    for (const s of lane) {
      const c = clusters[clusters.length - 1];
      const first = c?.[0];
      if (c && first && weekFraction(s.at, r.start, r.end) - weekFraction(first.at, r.start, r.end) < 0.012) c.push(s);
      else clusters.push([s]);
    }
    return clusters.flatMap((c) => {
      const f = weekFraction(c[0]?.at ?? r.start, r.start, r.end);
      return c.map((s, k) => ({ s, f, dx: (k - (c.length - 1) / 2) * 7, tone: tickTone(s) }));
    });
  }, [r.steps, r.start, r.end, labelOf]);
  const head = weekFraction(r.t, r.start, r.end);
  const nowF = weekFraction(r.limit, r.start, r.end);

  const at = (clientX: number) => {
    const el = track.current;
    if (!el) return r.t;
    const box = el.getBoundingClientRect();
    return r.start + ((clientX - box.left) / Math.max(1, box.width)) * (r.end - r.start);
  };
  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.rw-tick')) return;
    drag.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    r.pause();
    r.seek(at(e.clientX));
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => { if (drag.current) r.seek(at(e.clientX)); };
  const onUp = () => { drag.current = false; };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 86400 : 3600;
    const keys: Record<string, () => void> = {
      ArrowRight: () => r.seek(r.t + step), ArrowLeft: () => r.seek(r.t - step),
      Home: () => r.seek(r.start), End: () => r.seek(r.limit),
      ' ': () => (r.playing ? r.pause() : r.play()),
    };
    const k = keys[e.key];
    if (!k) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key !== ' ') r.pause();
    k();
  };

  return (
    <div className="rw-bar" role="group" aria-label="Rewind the week">
      <div className="rw-row">
        <button type="button" className="rw-play" ref={playBtn} onClick={r.playing ? r.pause : r.play} aria-label={r.playing ? 'Pause' : 'Play the week'} title={r.playing ? 'Pause (Space)' : 'Play the week (Space)'}>
          {r.playing ? <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.5v9M11 3.5v9" /></svg> : <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3l8 5-8 5z" /></svg>}
        </button>
        <span className="rw-week">
          <button type="button" className="rw-nav" onClick={() => r.shiftWeek(-1)} aria-label="The week before" title="The week before">‹</button>
          <b>{r.weekBack === 0 ? 'This week' : weekLabel(r.start, r.end)}</b>
          <button type="button" className="rw-nav" onClick={() => r.shiftWeek(1)} disabled={r.weekBack === 0} aria-label="The week after" title="The week after">›</button>
        </span>
        <span className="rw-legend" aria-label="What the ticks mean">
          {LEGEND.map((tone) => <span key={tone} title={TICK_WORD[tone]}><TickMark tone={tone} />{LEGEND_SHORT[tone]}</span>)}
        </span>
        <button type="button" className="rw-live" onClick={onExit} title="Leave Rewind and show the dial as it is now (Esc)">Back to now</button>
      </div>
      <div className="rw-track" ref={track} role="slider" tabIndex={0} aria-label="Playhead"
        aria-valuemin={r.start} aria-valuemax={r.limit} aria-valuenow={Math.round(r.t)} aria-valuetext={stepTime(r.t)}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onKey}>
        <div className="rw-groove">
          {DAYS.map((d, i) => <span key={d} className="rw-day" style={{ left: `${(i / 7) * 100}%` } as CSSProperties} />)}
          <span className="rw-later" style={{ left: `${nowF * 100}%` } as CSSProperties} aria-hidden="true" />
          <span className="rw-past" style={{ width: `${head * 100}%` } as CSSProperties} aria-hidden="true" />
        </div>
        <div className="rw-lane">
          {ticks.map(({ s, f, dx, tone }) => {
            const who = labelOf(s.deal_id);
            if (!who) return null;
            const said = narrate(s, { title: who.title, side: who.deal.side });
            return (
              <button key={`${s.deal_id}-${s.seq}`} type="button" className={`rw-tick t-${tone} ${s.at <= r.t ? 'on' : ''}`}
                style={{ left: `calc(${f * 100}% + ${dx}px)` } as CSSProperties}
                aria-label={said} title={`${said}\n${TICK_WORD[tone]} · opens the deal`}
                onClick={(e) => { e.stopPropagation(); onOpenDeal(s.deal_id); }}>
                <TickMark tone={tone} />
              </button>
            );
          })}
        </div>
        <span className="rw-head" style={{ left: `${head * 100}%` } as CSSProperties} aria-hidden="true"><i /></span>
        <div className="rw-days" aria-hidden="true">
          {DAYS.map((d, i) => <span key={d} style={{ left: `${((i + 0.5) / 7) * 100}%` } as CSSProperties}>{d}</span>)}
        </div>
      </div>
      {r.error ? <WalletNotice error={r.error} what="The week’s record" /> : null}
    </div>
  );
}

/** The hub while rewinding: the moment under the playhead, and the step that happened last. */
export function RewindHub({ r, labelOf, onOpenDeal }: { r: RewindState; labelOf: Labeller; onOpenDeal: (id: string) => void }) {
  const known = useMemo(() => r.steps.filter((s) => labelOf(s.deal_id)), [r.steps, labelOf]);
  const step = stepUnder(known, r.t);
  const who = step ? labelOf(step.deal_id) : null;
  const lane = known.filter((s) => s.at <= r.t);
  const calls = laneSteps(lane).filter((s) => !isRefusal(s)).length;
  const refused = lane.filter(isRefusal).length;
  const tone = step ? tickTone(step) : null;
  const money = step && (step.paypal.type === 'call' || isRefusal(step));
  return (
    <div className="hc rw-hub" key={step ? `${step.deal_id}-${step.seq}` : 'empty'}>
      <div className="h-eyebrow">Rewind · {stepTime(r.t)}</div>
      {r.loading ? <div className="h-week">reading the week…</div>
        : step && who ? (
          <>
            <div className={`rw-say ${money && tone ? `t-${tone}` : ''}`}>
              {money && tone ? <TickMark tone={tone} /> : null}
              <span>{narrate(step, { title: who.title, side: who.deal.side })}</span>
            </div>
            <div className="rw-meta">
              {!money || !tone ? 'no PayPal call' : tone === 'refused' ? (step.authority.type === 'signed_rule' ? 'Stopped by your rules' : 'Stopped by a safety check') : TICK_WORD[tone]}
            </div>
            <button type="button" className="hm-back rw-open" onClick={(e) => { e.stopPropagation(); onOpenDeal(step.deal_id); }}>Open deal ›</button>
          </>
        ) : <div className="h-calm rw-calm">Nothing yet this week</div>}
      <div className="h-week rw-count">
        {calls} PayPal {calls === 1 ? 'call' : 'calls'} · {refused} refused, PayPal never asked
      </div>
    </div>
  );
}
