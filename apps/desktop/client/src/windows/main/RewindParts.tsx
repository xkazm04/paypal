// The Rewind's scrubber and hub (Home shows them while rewinding; Rewind.tsx keeps the clock).
// Their own chunk (lib/lazy.ts): Home loads them once it is idle, so pressing R never waits.
import { useEffect, useMemo, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react';
import type { Deal } from '@bindings/Deal';
import type { HistoryStep } from '@bindings/HistoryStep';
import { WalletNotice } from '../../shared/honesty';
import { weekLabel } from './home/model';
import { endingCtx, isRefusal, laneSteps, narrate, stepTime, stepUnder, TICK_WORD, tickTone, weekFraction, type TickTone } from './logic';
import { TickMark, type RewindState } from './Rewind';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const LEGEND: readonly TickTone[] = ['owner', 'rule', 'buyer', 'default', 'refused'];
const LEGEND_SHORT: Record<TickTone, string> = { owner: 'You', rule: 'Your rule', buyer: 'Buyer approved', default: 'Safe default', refused: 'Refused', unknown: 'Not recorded' };

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
            const said = narrate(s, { title: who.title, side: who.deal.side, ...endingCtx(r.steps, s, r.unshown, r.unread) });
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
              <span>{narrate(step, { title: who.title, side: who.deal.side, ...endingCtx(r.steps, step, r.unshown, r.unread) })}</span>
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
