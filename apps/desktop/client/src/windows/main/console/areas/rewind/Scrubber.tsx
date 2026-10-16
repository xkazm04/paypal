// The Rewind's scrubber and hub (moved from RewindParts.tsx by rebuild WP3c, words in
// lib/words/rewind.ts): play, the week, the PayPal lane (one tick per money call, coloured by who
// decided it), the playhead, the legend, the day anchors; and the moment under the playhead with the
// step that happened last. Read-only.
import { useMemo, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react';
import type { Deal } from '@bindings/Deal';
import type { HistoryStep } from '@bindings/HistoryStep';
import { REWIND_BAR, REWIND_HUB, REWIND_THIS_WEEK, REWIND_TRUNCATED } from '../../../../../lib/words';
import { WalletNotice } from '../../../../../shared/honesty';
import { weekLabel } from '../../../home/model';
import { endingCtx, isRefusal, laneSteps, narrate, stepTime, stepUnder, TICK_WORD, tickTone, weekFraction, type TickTone } from '../../../logic';
import type { RewindState } from './clock';
import { TickMark } from './TickMark';

const LEGEND: readonly TickTone[] = ['owner', 'rule', 'buyer', 'default', 'refused'];
/** Ticks this close on the week (about two hours) sit side by side, centred on the first. */
const CLUSTER = 0.012;
const TICK_GAP_PX = 7;

export type Labeller = (dealId: string) => { deal: Deal; label: string; title: string } | null;

export function RewindBar({ r, labelOf, onOpenDeal, onExit }: { r: RewindState; labelOf: Labeller; onOpenDeal: (id: string) => void; onExit: () => void }) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef(false);
  const ticks = useMemo(() => {
    const lane = laneSteps(r.steps).filter((s) => labelOf(s.deal_id));
    const clusters: HistoryStep[][] = [];
    for (const s of lane) {
      const c = clusters[clusters.length - 1];
      const first = c?.[0];
      if (c && first && weekFraction(s.at, r.start, r.end) - weekFraction(first.at, r.start, r.end) < CLUSTER) c.push(s);
      else clusters.push([s]);
    }
    return clusters.flatMap((c) => {
      const f = weekFraction(c[0]?.at ?? r.start, r.start, r.end);
      return c.map((s, k) => ({ s, f, dx: (k - (c.length - 1) / 2) * TICK_GAP_PX, tone: tickTone(s) }));
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
    <div className="rw-bar" role="group" aria-label={REWIND_BAR.label}>
      <div className="rw-row">
        <button type="button" className="rw-play" onClick={r.playing ? r.pause : r.play} aria-label={r.playing ? REWIND_BAR.pause : REWIND_BAR.play} title={r.playing ? REWIND_BAR.pauseTitle : REWIND_BAR.playTitle} data-fk="rw-play">
          {r.playing ? <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.5v9M11 3.5v9" /></svg> : <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3l8 5-8 5z" /></svg>}
        </button>
        <span className="rw-week">
          <button type="button" className="rw-nav" onClick={() => r.shiftWeek(-1)} aria-label={REWIND_BAR.before} title={REWIND_BAR.before}>‹</button>
          <b>{r.weekBack === 0 ? REWIND_THIS_WEEK : weekLabel(r.start, r.end)}</b>
          <button type="button" className="rw-nav" onClick={() => r.shiftWeek(1)} disabled={r.weekBack === 0} aria-label={REWIND_BAR.after} title={REWIND_BAR.after}>›</button>
        </span>
        <span className="rw-legend" aria-label={REWIND_BAR.legend}>
          {LEGEND.map((tone) => <span key={tone} title={TICK_WORD[tone]}><TickMark tone={tone} />{REWIND_BAR.legendShort[tone]}</span>)}
        </span>
        <button type="button" className="rw-live" onClick={onExit} title={REWIND_BAR.nowTitle}>{REWIND_BAR.now}</button>
      </div>
      <div className="rw-track" ref={track} role="slider" tabIndex={0} aria-label={REWIND_BAR.playhead}
        aria-valuemin={r.start} aria-valuemax={r.limit} aria-valuenow={Math.round(r.t)} aria-valuetext={stepTime(r.t)}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onKey}>
        <div className="rw-groove">
          {REWIND_BAR.days.map((d, i) => <span key={d} className="rw-day" style={{ left: `${(i / 7) * 100}%` } as CSSProperties} />)}
          <span className="rw-later" style={{ left: `${nowF * 100}%` } as CSSProperties} aria-hidden="true" />
          <span className="rw-past" style={{ width: `${head * 100}%` } as CSSProperties} aria-hidden="true" />
        </div>
        <div className="rw-lane">
          {ticks.map(({ s, f, dx, tone }) => {
            const who = labelOf(s.deal_id);
            if (!who) return null;
            const said = narrate(s, { title: who.title, side: who.deal.side, ...endingCtx(r.steps, s, r.unshown, r.unread) });
            return (
              <button key={`${s.deal_id}-${s.seq}`} type="button" className={`rw-tick t-${tone} ${s.at <= r.t ? 'on' : ''}`} tabIndex={-1}
                style={{ left: `calc(${f * 100}% + ${dx}px)` } as CSSProperties}
                aria-label={said} title={`${said}\n${TICK_WORD[tone]} · ${REWIND_BAR.opens}`}
                onClick={(e) => { e.stopPropagation(); onOpenDeal(s.deal_id); }}>
                <TickMark tone={tone} />
              </button>
            );
          })}
        </div>
        <span className="rw-head" style={{ left: `${head * 100}%` } as CSSProperties} aria-hidden="true"><i /></span>
      </div>
      <div className="rw-days" role="group" aria-label={REWIND_BAR.jump}>
        {REWIND_BAR.days.map((d, i) => {
          const at0 = r.start + i * 86400;
          return (
            <button key={d} type="button" className={`rw-dayjump${r.t >= at0 && r.t < at0 + 86400 ? ' on' : ''}`} disabled={at0 > r.limit}
              style={{ left: `${((i + 0.5) / 7) * 100}%` } as CSSProperties} title={REWIND_BAR.jumpTo(d)} onClick={() => { r.pause(); r.seek(at0 + 12 * 3600); }}>{d}</button>
          );
        })}
      </div>
      {r.truncated ? <p className="dim">{REWIND_TRUNCATED}</p> : null}
      {r.error ? <WalletNotice error={r.error} what={REWIND_BAR.failed} /> : null}
    </div>
  );
}

/** The moment under the playhead, and the step that happened last. */
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
    <div className="hc rw-hub" key={step ? `${step.deal_id}-${step.seq}` : 'empty'} aria-live="off">
      <div className="h-eyebrow">{REWIND_HUB.at(stepTime(r.t))}</div>
      {r.loading ? <div className="h-week">{REWIND_HUB.reading}</div>
        : step && who ? (
          <>
            <div className={`rw-say ${money && tone ? `t-${tone}` : ''}`}>
              {money && tone ? <TickMark tone={tone} /> : null}
              <span>{narrate(step, { title: who.title, side: who.deal.side, ...endingCtx(r.steps, step, r.unshown, r.unread) })}</span>
            </div>
            <div className="rw-meta">
              {!money || !tone ? REWIND_HUB.noCall : tone === 'refused' ? (step.authority.type === 'signed_rule' ? REWIND_HUB.stoppedRules : REWIND_HUB.stoppedSafety) : TICK_WORD[tone]}
            </div>
            <button type="button" className="hm-back rw-open" onClick={(e) => { e.stopPropagation(); onOpenDeal(step.deal_id); }}>{REWIND_HUB.open}</button>
          </>
        ) : <div className="h-calm rw-calm">{REWIND_HUB.calm}</div>}
      <div className="h-week rw-count">{REWIND_HUB.count(calls, refused)}</div>
    </div>
  );
}
