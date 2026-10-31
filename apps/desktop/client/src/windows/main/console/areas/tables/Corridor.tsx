// "Watch the haggle": a table's signed offers replayed as two pucks closing on a price rail between
// the owner's walls. The market's typical range is a shaded lane, the most she pays is a hard wall,
// and where the wallet refused her agent a gold gate drops: the agent's puck lunges at it and bounces
// back, the caption says "the wallet refuses: not the agent", and the deal snaps shut only once the
// side that may say yes has said it. Every figure is a transcript price (modules/tables/corridor.ts
// builds the beats; its test proves the browser preview's recorded table equals the engine's run),
// and the figures shown are only ever landed prices, never one caught mid-slide.
// Frame-pure: the picture is a function of the clock, so play, pause, the timeline scrubber and
// reduced motion all agree. Under reduced motion, and in a hidden document (no animation frames), a
// replay that would start by itself shows its final frame; a replay the person plays steps from beat
// to beat with no slide, lunge or burst. The timeline names the beat it is on, the steps list is
// always there, and the one caption line is read out as each beat lands.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { usePrefersReducedMotion } from '../../../../../lib/hooks';
import { TABLES_WATCH as W } from '../../../../../lib/words';
import { Btn } from '../../../../../shared/ui';
import { captionOf, ease, frameAt, LEAD_MS, lunge, playbook, spread, stepTo, trackOf, xOf, type Beat, type Haggle, type Playbook } from '../../../modules/tables/corridor';
import { short } from '../../../modules/tables/ladder';

const pct = (f: number): string => `${(f * 100).toFixed(3)}%`;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** A landing ring grows and fades over this long. */
const PULSE_MS = 520;

/** Whether the document is hidden (a background tab, a minimised window, a frame off screen), kept
 *  current. A hidden document gets no animation frames, so a replay started there would sit on its
 *  first frame. */
function useHidden(): boolean {
  const read = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';
  const [hidden, setHidden] = useState(read);
  useEffect(() => {
    const sync = () => setHidden(read());
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);
  return hidden;
}

/** The clock: real time while playing, frozen while paused or scrubbed. `still` (reduced motion, or a
 *  hidden document) means a replay that starts by itself shows its final frame instead: on arrival, when
 *  the document is hidden mid-play, when calm motion is switched on mid-play, and when beats are added
 *  to a replay at rest. A replay the person starts (Play) still steps through under reduced motion; it
 *  ends at once while the document is hidden. Beats added to a replay resting at its end play on from
 *  there (the arena appends its wall hits this way). */
function useClock(total: number, autoplay: boolean, rate = 1, still = false, hidden = false) {
  const [t, setT] = useState(autoplay && !still ? 0 : total);
  const [playing, setPlaying] = useState(autoplay && !still);
  /** The play running now was started by the clock itself (arrival or added beats), not the person. */
  const auto = useRef(autoplay && !still);
  const base = useRef<{ wall: number; t: number } | null>(null);
  const tRef = useRef(t);
  tRef.current = t;
  const was = useRef(total);
  // Beats added: from the end of a replay at rest, play on (or show the new end when still).
  useEffect(() => {
    const before = was.current;
    was.current = total;
    if (total === before) return;
    if (tRef.current >= before && !playing) {
      if (still || !autoplay) setT(total);
      else { auto.current = true; base.current = null; setPlaying(true); }
    } else if (tRef.current > total) setT(total);
  }, [total]);
  // Reduced motion or a hidden document arriving mid-play: a play the clock started ends on its last frame.
  useEffect(() => {
    if (!playing) return;
    if ((still && auto.current) || hidden) { setT(total); setPlaying(false); }
  }, [still, hidden, playing, total]);
  useEffect(() => {
    if (!playing) { base.current = null; return; }
    // No frame clock (a test DOM) or a hidden document: show the end at once.
    if (typeof requestAnimationFrame !== 'function' || hidden) { setT(total); setPlaying(false); return; }
    let raf = 0;
    // `t` is read once, when a play starts; the frame loop owns it from there.
    const from = tRef.current;
    const tick = (now: number) => {
      if (!base.current) base.current = { wall: now, t: from };
      const next = Math.min(total, base.current.t + (now - base.current.wall) * rate);
      setT(next);
      if (next >= total) { setPlaying(false); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, total, hidden]);
  return {
    t, playing,
    play: () => { auto.current = false; if (t >= total) setT(0); setPlaying(true); },
    pause: () => setPlaying(false),
    seek: (to: number) => { setPlaying(false); setT(Math.max(0, Math.min(total, to))); },
  };
}

/** `compact`: the track and its caption only, decorative (the full replay is one click away), played
 *  once a little faster; the decision centre shows it above the owner's decision. */
export function Corridor({ haggle, who, autoplay = true, big = false, compact = false }: { haggle: Haggle; who: string; autoplay?: boolean; big?: boolean; compact?: boolean }) {
  const reduced = usePrefersReducedMotion();
  const hidden = useHidden();
  const pb = useMemo(() => playbook(haggle), [haggle]);
  const track = useMemo(() => trackOf(haggle), [haggle]);
  const lines = useMemo(() => haggle.beats.map((b) => captionOf(b, haggle, who)), [haggle, who]);
  const clock = useClock(pb.total, autoplay, compact ? 1.5 : 1, reduced || hidden, hidden);
  const [trackRef, widthPx] = useWidth();
  // Reduced motion: each beat is drawn as it rests (no slide, no lunge, no burst).
  const at = reduced ? restingTime(pb, clock.t) : clock.t;
  const f = frameAt(pb, at);
  if (!track) return null;
  const x = (v: number) => xOf(v, track);
  const m = (v: number) => short(v, haggle.currency);
  const buyer = haggle.side === 'buyer';
  const wall = buyer ? haggle.ceiling : haggle.floor;
  const call = haggle.askAbove;
  const caption = f.current >= 0 ? lines[f.current] : null;

  // the refusal: a refused yes is a gate in the gap between her agent and the price it tried; a
  // refusal at her limit is the wall itself. The agent lunges at the gate and bounces off it.
  const youPrice = f.trail.you[f.trail.you.length - 1] ?? null;
  const themPrice = f.trail.them[f.trail.them.length - 1] ?? null;
  const refused = f.refusal ?? (f.owner !== null ? lastRefusal(haggle) : null);
  const burst = f.snap && !reduced ? f.snap.p : 0;
  const pulse = (since: number | null) => (since === null || reduced ? 0 : clamp01(since / PULSE_MS));
  const met = f.snap?.p === 1;
  // The walls draw in before the first offer lands: the limit rises, the lane fades in, the gold edge runs.
  const drawn = reduced ? 1 : ease(clamp01(at / LEAD_MS));

  // Close pucks are drawn apart (more so with a gate between them); the snap brings them together.
  const [restF, themF] = f.you !== null && f.them !== null && !f.snap
    ? spread(x(f.you), x(f.them), widthPx, refused ? 40 : 28)
    : [f.you !== null ? x(f.you) : null, f.them !== null ? x(f.them) : null];
  // A refused yes stands midway between the two pucks as drawn; a refusal at her limit is the wall.
  const gateF = refused ? (refused.price !== null && restF !== null && themF !== null ? (restF + themF) / 2 : wall !== null ? x(wall) : null) : null;
  // The lunge is drawn on screen, after the spread: the agent's puck travels to the gate's face.
  const p = f.refusal && !reduced ? f.refusal.p : null;
  const travel = gateF !== null && restF !== null && widthPx > 0 ? ((gateF - restF) * widthPx - Math.sign(gateF - restF) * 15) / widthPx : 0;
  const youF = restF !== null && p !== null ? restF + travel * lunge(p) : restF;
  // the impact: the gate flares, a ring runs off it, the puck squashes and the track shakes once
  const impact = p !== null ? clamp01((p - 0.16) / 0.24) : 0;
  const flash = p !== null ? (p < 0.16 ? 0.35 * (p / 0.16) : Math.max(0, 1 - (p - 0.16) * 2.6)) : 0;
  const squash = p !== null ? Math.max(0, 1 - Math.abs(p - 0.16) / 0.05) : 0;
  const shake = impact > 0 && impact < 1 ? Math.sin(impact * Math.PI * 9) * 4 * (1 - impact) : 0;

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const to = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? stepTo(pb, clock.t, 1)
      : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? stepTo(pb, clock.t, -1)
        : e.key === 'Home' ? 0 : e.key === 'End' ? pb.total : null;
    if (to === null) return;
    e.preventDefault();
    clock.seek(to);
  };

  return (
    <section className={`hc${buyer ? '' : ' seller'}${met ? ' met' : ''}${big ? ' big' : ''}${compact ? ' compact' : ''}`}
      aria-label={compact ? undefined : W.watchAll} aria-hidden={compact ? true : undefined}>
      {compact ? null : <div className="hc-head" aria-hidden="true">
        <div className="hc-side you">
          <span className="hc-who">{W.you}</span>
          <b className="num">{met && f.snap ? m(f.snap.price) : youPrice !== null ? m(youPrice) : '—'}</b>
        </div>
        <div className="hc-gap">
          {met ? <span className="hc-met">{W.met}</span> : youPrice !== null && themPrice !== null ? <><b className="num">{m(Math.abs(themPrice - youPrice))}</b><span>{W.apart}</span></> : <span>&nbsp;</span>}
        </div>
        <div className="hc-side them">
          <span className="hc-who">{W.them(who)}</span>
          <b className="num">{met && f.snap ? m(f.snap.price) : themPrice !== null ? m(themPrice) : '—'}</b>
        </div>
      </div>}

      <div className="hc-track" aria-hidden="true" ref={trackRef} style={shake ? { transform: `translateX(${shake.toFixed(2)}px)` } : undefined}>
        {haggle.market ? (
          <div className="hc-lane" style={{ left: pct(x(haggle.market.p25)), width: pct(x(haggle.market.p75) - x(haggle.market.p25)), opacity: drawn }}>
            <span className="hc-median" style={{ left: pct((x(haggle.market.median) - x(haggle.market.p25)) / Math.max(1e-9, x(haggle.market.p75) - x(haggle.market.p25))) }} />
            <span className="hc-lane-label">{W.marketRange(m(haggle.market.p25), m(haggle.market.p75))}</span>
          </div>
        ) : null}
        {call !== null ? (
          // Her call is above the line on either side of the table: the wallet asks her whenever the
          // amount is over it (mandate.rs, clause 6), buying or selling.
          <div className={`hc-call${call < track.lo ? ' off' : ''}`} style={{ left: pct(x(call)), right: 0, clipPath: `inset(0 ${((1 - drawn) * 100).toFixed(1)}% 0 0)` }}>
            <span>{W.yourCall(m(call))}</span>
          </div>
        ) : null}
        <div className="hc-rail" />
        {track.ticks.map((p) => <span key={p} className="hc-tick" style={{ left: pct(x(p)) }} />)}
        {wall !== null ? (
          <div className={`hc-wall${f.refusal && f.refusal.clause === 4 ? ' hit' : ''}`} style={{ left: pct(x(wall)), '--drawn': drawn.toFixed(3) } as CSSProperties}>
            <span className="hc-wall-label">{buyer ? W.most : W.least} <b className="num">{m(wall)}</b></span>
          </div>
        ) : null}

        {/* the trail: every price each side signed, fading with age */}
        {(['them', 'you'] as const).map((side) => f.trail[side].map((p, i, all) => (
          <span key={`${side}${i}`} className={`hc-dot ${side}`} style={{ left: pct(x(p)), opacity: 0.25 + 0.55 * ((i + 1) / all.length) }} />
        )))}

        {gateF !== null ? (
          <div className="hc-gate" style={{ left: pct(gateF), '--flash': flash.toFixed(3), '--impact': impact.toFixed(3) } as CSSProperties}>
            {impact > 0 && impact < 1 ? <span className="hc-shock" /> : null}
            <span className="hc-gate-tag">{f.owner !== null ? W.yourCallTag : W.refusedTag}</span>
            {f.owner !== null ? <span className="hc-hold" style={{ '--hold': f.owner.toFixed(3) } as CSSProperties} /> : null}
          </div>
        ) : null}

        {themF !== null && themPrice !== null ? <Puck side="them" x={themF} label={m(f.snap ? f.snap.price : themPrice)} hide={met} pulse={pulse(f.since.them)} /> : null}
        {youF !== null && youPrice !== null ? <Puck side="you" x={youF} label={m(f.snap ? f.snap.price : youPrice)} hide={met} pulse={pulse(f.since.you)} squash={squash} /> : null}
        {f.snap ? (
          <div className={`hc-deal${met ? ' on' : ''}`} style={{ left: pct(x(f.snap.price)), '--burst': burst.toFixed(3) } as CSSProperties}>
            <span className="hc-burst" />
            <span className="hc-deal-tag num">{m(f.snap.price)}</span>
          </div>
        ) : null}
      </div>

      <p className={`hc-caption${f.refusal || f.owner !== null ? ' gold' : ''}`}>{caption ?? ' '}</p>
      {/* Read out when it settles (paused, scrubbed, or at the end), not every beat while it plays:
          a screen reader would fall behind the motion. The steps list holds every line. */}
      {compact ? null : <p className="sr-only" aria-live="polite" aria-atomic="true">{clock.playing ? '' : caption ?? ''}</p>}

      {compact ? null : <>
      <div className="hc-time">
        <div className="hc-marks" aria-hidden="true">
          {pb.cues.map((c) => <span key={c.i} className={`hc-mark ${markOf(c.beat)}${c.i <= f.current ? ' on' : ''}`} style={{ left: pct(c.at / pb.total) }} />)}
          <span className="hc-fill" style={{ width: pct(clock.t / pb.total) }} />
        </div>
        <input type="range" className="hc-scrub" min={0} max={pb.total} step={10} value={Math.round(clock.t)}
          aria-label={W.timeline} aria-valuetext={caption ? W.beatOf(f.current + 1, lines.length, caption) : W.notStarted}
          onChange={(e) => clock.seek(Number(e.target.value))} onKeyDown={onKey} />
      </div>

      <div className="hc-foot">
        {clock.playing ? <Btn sm onClick={clock.pause}>{W.pause}</Btn> : <Btn sm kind="primary" onClick={clock.play} title={W.playTitle}>{f.done ? W.replay : clock.t > 0 ? W.resume : W.play}</Btn>}
        {!f.done ? <Btn sm kind="plain" onClick={() => clock.seek(pb.total)}>{W.skip}</Btn> : null}
        <span className="ui-spacer" />
        {haggle.maxOffers ? <span className="hc-offers num">{W.offersLeft(f.offers, haggle.maxOffers)}</span> : null}
      </div>

      <details className="hc-steps">
        <summary>{W.stepsTitle}</summary>
        <ol>{lines.map((l, i) => <li key={i} className={i <= f.current ? 'on' : undefined}>{l}</li>)}</ol>
      </details>
      </>}
    </section>
  );
}

function Puck({ side, x, label, hide, pulse, squash = 0 }: { side: 'you' | 'them'; x: number; label: string; hide: boolean; pulse: number; squash?: number }) {
  return (
    <div className={`hc-puck ${side}${hide ? ' gone' : ''}`} style={{ left: pct(x), '--pulse': pulse.toFixed(3), '--squash': squash.toFixed(3) } as CSSProperties}>
      {pulse > 0 && pulse < 1 ? <span className="hc-ring" /> : null}
      <span className="hc-puck-tag num">{label}</span>
    </div>
  );
}

/** The timeline mark's colour: their side, ours, or the owner's walls (gold). */
function markOf(b: Beat): string {
  if (b.kind === 'price' || b.kind === 'accept' || b.kind === 'withdrawn') return b.by;
  return 'gold';
}

/** Under reduced motion, the clock shows each beat at rest: the moment its slide and bounce end. */
function restingTime(pb: Playbook, t: number): number {
  let shown = 0;
  for (const c of pb.cues) {
    if (t < c.at) break;
    shown = c.at + c.hold - 1;
  }
  return t >= pb.total ? pb.total : shown;
}

/** The gate stays where the wallet last refused, while the owner decides. */
function lastRefusal(h: Haggle): { price: number | null; clause: number | null } | null {
  for (let i = h.beats.length - 1; i >= 0; i--) {
    const b = h.beats[i];
    if (b?.kind === 'refused') return { price: b.price, clause: b.clause };
  }
  return null;
}

/** The element's width in pixels, kept current as it resizes (0 until measured). The ref is stable, so
 *  the observer is made once per element, not once per frame. */
function useWidth(): [(el: HTMLDivElement | null) => void, number] {
  const [w, setW] = useState(0);
  const obs = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLDivElement | null) => {
    obs.current?.disconnect();
    obs.current = null;
    if (!el) return;
    setW(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    obs.current = new ResizeObserver((entries) => { const e = entries[0]; if (e) setW(e.contentRect.width); });
    obs.current.observe(el);
  }, []);
  return [ref, w];
}
